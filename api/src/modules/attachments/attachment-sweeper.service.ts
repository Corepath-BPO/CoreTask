import { AttachmentStatus, PENDING_UPLOAD_TTL_MINUTES } from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../integrations/storage/storage.service';

/**
 * Clears out uploads that were started and never finished.
 *
 * A presigned URL that is issued and then abandoned — the tab closed, the
 * network dropped — leaves a PENDING row and possibly bytes nobody will ever
 * ask for. Nothing reaps those on its own, so this does.
 *
 * Deliberately its own service rather than a method on `AttachmentsService`.
 * That one depends on tasks, tickets and activity logging to do its real work,
 * and importing it into the worker drags the entire request-side graph —
 * notifications, the websocket gateway — into a process that has no use for
 * any of it. Sweeping needs a database and a bucket, and that is all this asks
 * for.
 */
@Injectable()
export class AttachmentSweeperService {
  private readonly logger = new Logger(AttachmentSweeperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async sweepAbandonedUploads(): Promise<{ swept: number }> {
    const cutoff = new Date(Date.now() - PENDING_UPLOAD_TTL_MINUTES * 60_000);

    const abandoned = await this.prisma.attachment.findMany({
      where: { status: AttachmentStatus.PENDING, createdAt: { lt: cutoff } },
      select: { id: true, objectKey: true },
    });

    let swept = 0;

    for (const attachment of abandoned) {
      // One failure must not abandon the rest of the batch. Storage and the
      // database can disagree, and clearing the row is the part that matters —
      // a stranded object is waste, a stranded row is a bug.
      try {
        await this.storage.deleteObject(attachment.objectKey);
      } catch (error) {
        this.logger.warn({ attachmentId: attachment.id, err: error }, 'Could not delete object');
      }

      await this.prisma.attachment.delete({ where: { id: attachment.id } });
      swept += 1;
    }

    if (swept > 0) {
      this.logger.log({ swept }, 'Swept abandoned uploads');
    }

    return { swept };
  }
}
