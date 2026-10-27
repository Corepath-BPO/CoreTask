import { Module } from '@nestjs/common';

import { AsanaClientModule } from '../../integrations/asana/asana.module';
import { StorageModule } from '../../integrations/storage/storage.module';

import { AsanaImporter } from './asana-importer.service';

/** The worker side of the Asana import. */
@Module({
  imports: [AsanaClientModule, StorageModule],
  providers: [AsanaImporter],
  exports: [AsanaImporter],
})
export class AsanaImporterModule {}
