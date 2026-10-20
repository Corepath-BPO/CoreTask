import { Module } from '@nestjs/common';

import { StorageModule } from '../../integrations/storage/storage.module';

import { AvatarController, AvatarImageController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { ProfileController } from './profile.controller';
import { UsersService } from './users.service';

@Module({
  imports: [StorageModule],
  controllers: [ProfileController, AvatarController, AvatarImageController],
  providers: [UsersService, AvatarService],
  exports: [UsersService, AvatarService],
})
export class UsersModule {}
