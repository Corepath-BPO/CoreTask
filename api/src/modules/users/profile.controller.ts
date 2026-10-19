import type { AuthUser } from '@coretask/types';
import { Body, Controller, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';

import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

/**
 * The caller's own profile. Session-only: a workspace API key acts as a
 * hidden service account, which has no profile to keep.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller('users/me')
@SessionOnly()
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class ProfileController {
  constructor(private readonly users: UsersService) {}

  @Patch()
  @ApiOperation({ summary: 'Update your name, time zone, profile and time off' })
  update(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto): Promise<AuthUser> {
    return this.users.updateProfile(userId, dto);
  }
}
