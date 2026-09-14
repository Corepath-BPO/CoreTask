import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { RealtimeRelaySubscriber } from './realtime-relay.subscriber';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  imports: [JwtModule.register({})],
  // The subscriber lives here, beside the gateway it relays into, so the
  // worker's broadcasts reach browsers exactly where sockets are held.
  providers: [RealtimeGateway, RealtimeRelaySubscriber],
  exports: [RealtimeGateway],
})
export class WebsocketModule {}
