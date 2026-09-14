import { Module } from '@nestjs/common';

import { FollowersModule } from '../../modules/followers/followers.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';

import { DescriptionMentionNotifier } from './description-mention.notifier';
import { FieldChangeNotifier } from './field-change.notifier';
import { FollowerNotifier } from './follower.notifier';
import { NotificationDispatcher } from './notification.dispatcher';

@Module({
  imports: [NotificationsModule, FollowersModule],
  providers: [
    NotificationDispatcher,
    DescriptionMentionNotifier,
    FollowerNotifier,
    FieldChangeNotifier,
  ],
  exports: [
    NotificationDispatcher,
    DescriptionMentionNotifier,
    FollowerNotifier,
    FieldChangeNotifier,
  ],
})
export class NotificationsIntegrationModule {}
