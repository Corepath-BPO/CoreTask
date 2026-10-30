import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class HandOverDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'An active member to take over their open tasks and tickets, in the projects that member may be assigned in: its members, or the owner anywhere. Omitted, the work is unassigned.',
  })
  @IsOptional()
  @IsUUID()
  reassignToUserId?: string | null;
}
