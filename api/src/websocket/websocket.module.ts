import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { ProjectAccessModule } from '../modules/project-access/project-access.module';

import { ProjectBroadcastService } from './project-broadcast.service';
import { RealtimeRelaySubscriber } from './realtime-relay.subscriber';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  // Project access is a Prisma-only leaf, so importing it here — into the one
  // global module — is what lets every domain module broadcast by audience
  // without each of them importing it in turn.
  imports: [JwtModule.register({}), ProjectAccessModule],
  // The subscriber lives here, beside the gateway it relays into, so the
  // worker's broadcasts reach browsers exactly where sockets are held.
  providers: [RealtimeGateway, RealtimeRelaySubscriber, ProjectBroadcastService],
  exports: [RealtimeGateway, ProjectBroadcastService],
})
export class WebsocketModule {}
