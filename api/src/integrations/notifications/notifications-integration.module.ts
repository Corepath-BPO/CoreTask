import { Module } from '@nestjs/common';

import { FollowersModule } from '../../modules/followers/followers.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { ProjectAccessModule } from '../../modules/project-access/project-access.module';

import { DescriptionMentionNotifier } from './description-mention.notifier';
import { FieldChangeNotifier } from './field-change.notifier';
import { FollowerNotifier } from './follower.notifier';
import { NotificationDispatcher } from './notification.dispatcher';
import { ProjectActivityNotifier } from './project-activity.notifier';

@Module({
  imports: [NotificationsModule, FollowersModule, ProjectAccessModule],
  providers: [
    NotificationDispatcher,
    DescriptionMentionNotifier,
    FollowerNotifier,
    FieldChangeNotifier,
    ProjectActivityNotifier,
  ],
  exports: [
    NotificationDispatcher,
    DescriptionMentionNotifier,
    FollowerNotifier,
    FieldChangeNotifier,
    ProjectActivityNotifier,
  ],
})
export class NotificationsIntegrationModule {}
