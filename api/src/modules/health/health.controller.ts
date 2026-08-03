import type { HealthStatus } from '@coretask/types';
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope.decorator';
import { Public } from '../../common/decorators/public.decorator';

import { HealthStatusDto } from './dto/health.dto';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liveness and dependency check',
    description:
      'Always answers 200 so an orchestrator can distinguish "process is up" from "dependency is down"; read `data.status` for the verdict.',
  })
  @ApiEnvelopeResponse(HealthStatusDto)
  check(): Promise<HealthStatus> {
    return this.health.check();
  }
}
