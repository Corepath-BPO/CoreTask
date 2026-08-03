import { Module } from '@nestjs/common';

import { NotificationsModule } from '../../modules/notifications/notifications.module';

import { NotificationDispatcher } from './notification.dispatcher';

@Module({
  imports: [NotificationsModule],
  providers: [NotificationDispatcher],
  exports: [NotificationDispatcher],
})
export class NotificationsIntegrationModule {}
