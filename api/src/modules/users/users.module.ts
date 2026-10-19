import { Module } from '@nestjs/common';

import { ProfileController } from './profile.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [ProfileController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
