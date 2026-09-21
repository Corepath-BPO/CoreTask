import { Module } from '@nestjs/common';

import { ProjectAccessGuard } from './project-access.guard';
import { ProjectAccessService } from './project-access.service';

/**
 * A leaf: it depends on nothing but the (global) Prisma module, so followers,
 * activity, notifications and the websocket gateway can all import it without
 * a cycle. Keep it that way — everything that filters by project visibility
 * needs to reach this service.
 */
@Module({
  providers: [ProjectAccessService, ProjectAccessGuard],
  exports: [ProjectAccessService, ProjectAccessGuard],
})
export class ProjectAccessModule {}
