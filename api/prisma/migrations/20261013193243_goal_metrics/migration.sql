-- AlterEnum
ALTER TYPE "GoalProgressSource" ADD VALUE 'METRIC';

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "metricCurrent" DOUBLE PRECISION,
ADD COLUMN     "metricStart" DOUBLE PRECISION,
ADD COLUMN     "metricTarget" DOUBLE PRECISION,
ADD COLUMN     "metricUnit" VARCHAR(16);
