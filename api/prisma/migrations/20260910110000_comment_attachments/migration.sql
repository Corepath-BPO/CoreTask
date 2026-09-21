-- A file may be posted with a comment. It still belongs to the task or ticket
-- (see the column comment in schema.prisma); the comment merely shows it, so
-- deleting the comment leaves the file and clears the pointer.

ALTER TABLE "attachments" ADD COLUMN "commentId" UUID;

CREATE INDEX "attachments_commentId_idx" ON "attachments"("commentId");

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
