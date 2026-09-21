-- Stories the task panel's activity feed can show, and the notification types
-- that fan out to a task's followers. Appended in schema.prisma order so
-- `migrate diff` stays silent. None of these values are written by this
-- migration: Postgres refuses to use an enum value inside the transaction
-- that added it.

ALTER TYPE "ActivityAction" ADD VALUE 'FIELD_CHANGED';
ALTER TYPE "ActivityAction" ADD VALUE 'ATTACHED';
ALTER TYPE "ActivityAction" ADD VALUE 'DETACHED';
ALTER TYPE "ActivityAction" ADD VALUE 'FOLLOWED';
ALTER TYPE "ActivityAction" ADD VALUE 'UNFOLLOWED';
ALTER TYPE "ActivityAction" ADD VALUE 'SUBTASK_ADDED';
ALTER TYPE "ActivityAction" ADD VALUE 'PINNED';
ALTER TYPE "ActivityAction" ADD VALUE 'UNPINNED';

ALTER TYPE "NotificationType" ADD VALUE 'TASK_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'TICKET_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'FIELD_CHANGED';
