-- AlterEnum
-- Positioned rather than appended so the database's value order matches
-- schema.prisma; see the note on the TEAM migration for why that matters.
ALTER TYPE "ActivityEntity" ADD VALUE 'ATTACHMENT' BEFORE 'USER';
