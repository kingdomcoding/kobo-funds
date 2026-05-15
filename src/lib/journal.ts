import type { AccountKind, Currency, Prisma, PrismaClient } from '@prisma/client';
import { writeAudit, type AuditActorType } from './audit.js';
import { AppError } from './errors.js';

type Client = PrismaClient | Prisma.TransactionClient;

export type PostingInput = {
  accountKey: string;
  amountMinor: bigint;
  currency: Currency;
};

export type JournalInput = {
  memo: string;
  postings: PostingInput[];
  txId?: string;
  actorUserId?: string;
  actorType?: AuditActorType;
  auditAction?: string;
  auditSubject?: string;
  auditMetadata?: Prisma.InputJsonValue;
  requestId?: string;
  tx: Client;
};

export type JournalResult = { journalEntryId: string };

export async function postJournal(input: JournalInput): Promise<JournalResult> {
  if (input.postings.length < 2) {
    throw new AppError(500, 'INTERNAL', 'Journal must have at least 2 postings');
  }
  const sumsByCurrency = new Map<Currency, bigint>();
  for (const p of input.postings) {
    sumsByCurrency.set(p.currency, (sumsByCurrency.get(p.currency) ?? 0n) + p.amountMinor);
  }
  for (const [currency, sum] of sumsByCurrency) {
    if (sum !== 0n) {
      throw new AppError(
        500,
        'INTERNAL',
        `Journal unbalanced for ${currency}: net ${sum.toString()}`,
      );
    }
  }

  const accountIdByKey = new Map<string, string>();
  for (const p of input.postings) {
    if (accountIdByKey.has(p.accountKey)) continue;
    const acc = await ensureAccount(input.tx, p.accountKey, p.currency);
    accountIdByKey.set(p.accountKey, acc.id);
  }

  const entry = await input.tx.journalEntry.create({
    data: {
      memo: input.memo,
      ...(input.txId !== undefined ? { txId: input.txId } : {}),
      postings: {
        create: input.postings.map((p) => ({
          accountId: accountIdByKey.get(p.accountKey) as string,
          amountMinor: p.amountMinor,
          currency: p.currency,
        })),
      },
    },
  });

  if (input.auditAction && input.auditSubject) {
    await writeAudit({
      tx: input.tx,
      ...(input.actorUserId !== undefined ? { userId: input.actorUserId } : {}),
      action: input.auditAction,
      subject: input.auditSubject,
      ...(input.actorType !== undefined ? { actorType: input.actorType } : {}),
      ...(input.auditMetadata !== undefined ? { metadata: input.auditMetadata } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    });
  }
  return { journalEntryId: entry.id };
}

async function ensureAccount(
  tx: Client,
  key: string,
  currency: Currency,
): Promise<{ id: string }> {
  const existing = await tx.account.findUnique({ where: { key } });
  if (existing) return { id: existing.id };
  const kind = kindFromKey(key);
  const created = await tx.account.create({
    data: { key, kind, currency: kindIsUnit(kind) ? null : currency },
  });
  return { id: created.id };
}

function kindFromKey(key: string): AccountKind {
  if (key.startsWith('user:wallet-pending:')) return 'USER_WALLET_PENDING';
  if (key.startsWith('user:wallet:')) return 'USER_WALLET';
  if (key.startsWith('user:units:')) return 'USER_UNITS';
  if (key.startsWith('bank:suspense:')) return 'BANK_SUSPENSE';
  if (key.startsWith('bank:cash:')) return 'BANK_CASH';
  if (key.startsWith('fund:units-outstanding:')) return 'FUND_UNITS_OUTSTANDING';
  throw new AppError(500, 'INTERNAL', `Unknown account key shape: ${key}`);
}

function kindIsUnit(k: AccountKind): boolean {
  return k === 'USER_UNITS' || k === 'FUND_UNITS_OUTSTANDING';
}
