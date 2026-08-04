import { Module } from '@nestjs/common';

import { EmailService } from './email.service';
import { MicrosoftGraphTransport } from './microsoft-graph.transport';

@Module({
  providers: [EmailService, MicrosoftGraphTransport],
  exports: [EmailService],
})
export class EmailModule {}
