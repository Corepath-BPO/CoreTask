import { Module } from '@nestjs/common';

import { StorageModule } from '../../integrations/storage/storage.module';

import { AttachmentSweeperService } from './attachment-sweeper.service';

/**
 * The sweeper on its own, with nothing else attached.
 *
 * `AttachmentsModule` needs tasks, tickets and activity logging; the worker
 * needs none of those and would fail to boot trying to resolve what they in
 * turn depend on. Keeping the housekeeping in a module of its own means the
 * worker imports a database and a bucket, and stops there.
 */
@Module({
  imports: [StorageModule],
  providers: [AttachmentSweeperService],
  exports: [AttachmentSweeperService],
})
export class AttachmentSweeperModule {}
