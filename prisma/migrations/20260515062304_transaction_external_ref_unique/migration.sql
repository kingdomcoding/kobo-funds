-- AlterTable: ensure unique constraint on Transaction.externalRef
CREATE UNIQUE INDEX "Transaction_externalRef_key" ON "Transaction"("externalRef");
