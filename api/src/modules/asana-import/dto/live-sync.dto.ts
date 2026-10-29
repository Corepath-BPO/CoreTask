import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetAsanaLiveSyncDto {
  @ApiProperty({ description: 'On to follow Asana as it changes, off to stop.' })
  @IsBoolean()
  enabled!: boolean;
}
