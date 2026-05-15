import { PrismaClient, type Currency, type LedgerEntryKind } from '@prisma/client';
import { postJournal, type PostingInput } from '../src/lib/journal.js';

const db = new PrismaClient();

function counterpartyKey(kind: LedgerEntryKind, currency: Currency): string {
  switch (kind) {
    case 'WALLET_FUND_IN':
      return `bank:suspense:${currency}`;
    case 'WALLET_FUND_OUT':
      return `bank:suspense:${currency}`;
    case 'SUBSCRIPTION_DEBIT':
      return `bank:cash:${currency}`;
    case 'REDEMPTION_CREDIT':
      return `bank:cash:${currency}`;
  }
}

async function main(): Promise<void> {
  const entries = await db.ledgerEntry.findMany({
    orderBy: { createdAt: 'asc' },
    include: { wallet: true },
  });

  let ported = 0;
  let skipped = 0;

  for (const e of entries) {
    if (e.txId) {
      const mirrored = await db.journalEntry.findFirst({ where: { txId: e.txId } });
      if (mirrored) {
        skipped++;
        continue;
      }
    }

    const userKey = `user:wallet:${e.wallet.userId}:${e.wallet.currency}`;
    const counter = counterpartyKey(e.kind, e.wallet.currency);
    const userPostingAmount = e.amountMinor;

    const postings: PostingInput[] = [
      { accountKey: userKey, amountMinor: userPostingAmount, currency: e.wallet.currency },
      { accountKey: counter, amountMinor: -userPostingAmount, currency: e.wallet.currency },
    ];

    await db.$transaction(async (tx) => {
      await postJournal({
        tx,
        ...(e.txId ? { txId: e.txId } : {}),
        memo: `[backfill] ${e.kind} ${e.reference}`,
        postings,
      });
    });
    ported++;
  }

  console.log(`backfill: ported=${ported} skipped=${skipped}`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
