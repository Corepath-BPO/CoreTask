-- AlterEnum
-- `BEFORE 'USER'` is not cosmetic: without a position Postgres appends, and the
-- database's value order would then disagree with schema.prisma. Keeping the two
-- identical is what lets a future `migrate diff` stay silent.
ALTER TYPE "ActivityEntity" ADD VALUE 'TEAM' BEFORE 'USER';
