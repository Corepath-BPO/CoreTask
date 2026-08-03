import { ApiProperty } from '@nestjs/swagger';

export class HealthStatusDto {
  @ApiProperty({ enum: ['ok', 'degraded'], example: 'ok' })
  status!: 'ok' | 'degraded';

  @ApiProperty({ enum: ['connected', 'disconnected'], example: 'connected' })
  database!: 'connected' | 'disconnected';

  @ApiProperty({ enum: ['connected', 'disconnected'], example: 'connected' })
  redis!: 'connected' | 'disconnected';

  @ApiProperty({ example: 128 })
  uptimeSeconds!: number;

  @ApiProperty({ example: '0.1.0' })
  version!: string;
}
