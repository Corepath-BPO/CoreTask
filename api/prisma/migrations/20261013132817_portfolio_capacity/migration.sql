-- AlterTable
ALTER TABLE "portfolios" ADD COLUMN     "defaultCapacity" INTEGER,
ADD COLUMN     "workloadMeasure" VARCHAR(10) NOT NULL DEFAULT 'TASKS';

-- CreateTable
CREATE TABLE "portfolio_capacities" (
    "portfolioId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "portfolio_capacities_pkey" PRIMARY KEY ("portfolioId","userId")
);

-- AddForeignKey
ALTER TABLE "portfolio_capacities" ADD CONSTRAINT "portfolio_capacities_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_capacities" ADD CONSTRAINT "portfolio_capacities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
