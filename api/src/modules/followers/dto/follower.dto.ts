import { MAX_FOLLOWERS_PER_ADD } from '@coretask/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class AddFollowersDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: MAX_FOLLOWERS_PER_ADD,
    description: 'Workspace members to add as collaborators.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FOLLOWERS_PER_ADD)
  @IsUUID('all', { each: true })
  userIds!: string[];
}
