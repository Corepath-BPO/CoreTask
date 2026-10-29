import { Module } from '@nestjs/common';

import { AsanaClientModule } from '../../integrations/asana/asana.module';
import { StorageModule } from '../../integrations/storage/storage.module';
import { RealtimeRelayPublisher } from '../../websocket/realtime-relay.publisher';

import { AsanaImporter } from './asana-importer.service';
import { AsanaLiveSyncService } from './asana-live-sync.service';

/** The worker side of the Asana import, and of its live sync. */
@Module({
  imports: [AsanaClientModule, StorageModule],
  providers: [AsanaImporter, AsanaLiveSyncService, RealtimeRelayPublisher],
  exports: [AsanaImporter, AsanaLiveSyncService],
})
export class AsanaImporterModule {}
