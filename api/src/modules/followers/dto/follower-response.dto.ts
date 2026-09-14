import { ApiProperty } from '@nestjs/swagger';

/** Swagger model mirroring `Follower` in `@coretask/types`. */

export class FollowerUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Demo Owner' })
  name!: string;

  @ApiProperty({ example: 'demo@coretask.dev' })
  email!: string;

  @ApiProperty({ nullable: true, example: null })
  avatarUrl!: string | null;
}

export class FollowerDto {
  @ApiProperty({ type: FollowerUserDto })
  user!: FollowerUserDto;

  @ApiProperty({ format: 'date-time' })
  followedAt!: string;
}
