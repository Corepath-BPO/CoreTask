-- AlterTable
ALTER TABLE "users" ADD COLUMN     "aboutMe" TEXT,
ADD COLUMN     "department" VARCHAR(80),
ADD COLUMN     "jobTitle" VARCHAR(80),
ADD COLUMN     "outOfOfficeFrom" DATE,
ADD COLUMN     "outOfOfficeNote" VARCHAR(200),
ADD COLUMN     "outOfOfficeUntil" DATE,
ADD COLUMN     "pronouns" VARCHAR(40);
