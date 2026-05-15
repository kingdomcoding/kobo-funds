-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('USER_WALLET', 'USER_WALLET_PENDING', 'USER_UNITS', 'BANK_SUSPENSE', 'BANK_CASH', 'FUND_UNITS_OUTSTANDING');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "currency" "Currency",
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Account_key_key" ON "Account"("key");
CREATE INDEX "Account_kind_idx" ON "Account"("kind");

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "txId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JournalEntry_txId_idx" ON "JournalEntry"("txId");
CREATE INDEX "JournalEntry_createdAt_idx" ON "JournalEntry"("createdAt");

-- CreateTable
CREATE TABLE "Posting" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Posting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Posting_accountId_idx" ON "Posting"("accountId");
CREATE INDEX "Posting_journalEntryId_idx" ON "Posting"("journalEntryId");
CREATE INDEX "Posting_currency_idx" ON "Posting"("currency");

ALTER TABLE "Posting" ADD CONSTRAINT "Posting_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
