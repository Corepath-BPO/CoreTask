import { Module } from '@nestjs/common';

import { AsanaApiClient } from './asana-api.client';

/** Asana's REST API, read-only, for the importer and the page that starts it. */
@Module({
  providers: [AsanaApiClient],
  exports: [AsanaApiClient],
})
export class AsanaClientModule {}
