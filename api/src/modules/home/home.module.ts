import { Module } from '@nestjs/common';

import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [WorkspaceMembersModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
