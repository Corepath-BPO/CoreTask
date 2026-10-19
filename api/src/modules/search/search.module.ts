import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { SavedSearchesController } from './saved-searches.controller';
import { SavedSearchesService } from './saved-searches.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { TaskSearchService } from './task-search.service';

@Module({
  imports: [WorkspaceMembersModule, ProjectAccessModule],
  controllers: [SearchController, SavedSearchesController],
  providers: [SearchService, TaskSearchService, SavedSearchesService],
})
export class SearchModule {}
