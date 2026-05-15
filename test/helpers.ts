import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { Prisma, type Currency, type FundKind, type KycTier } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { db } from '../src/lib/db.js';

type Seeded = {
  app: FastifyInstance;
  token: string;
  userId: string;
};

export async function resetDb(): Promise<void> {
  const tableNames = ['AuditEntry', 'IdempotencyKey', 'LedgerEntry', 'Holding', 'NavSnapshot', 'Transaction', 'Wallet', 'Kyc', 'RefreshToken', 'Fund', 'User'];
  for (const t of tableNames) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE`);
  }
}

export async function bootApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export async function seedFund(opts: {
  code: string;
  kind?: FundKind;
  currency?: Currency;
  unitPriceMinor?: bigint;
  settlementDays?: number;
}): Promise<void> {
  await db.fund.upsert({
    where: { code: opts.code },
    create: {
      code: opts.code,
      name: `${opts.code} Test Fund`,
      kind: opts.kind ?? 'MONEY_MARKET',
      currency: opts.currency ?? 'NGN',
      unitPriceMinor: opts.unitPriceMinor ?? 1_000n * 100n * 10_000n,
      settlementDays: opts.settlementDays ?? 0,
    },
    update: {},
  });
}

export async function createFundedUser(
  app: FastifyInstance,
  opts: { tier?: KycTier; ngnBalanceMinor?: bigint } = {},
): Promise<Seeded> {
  const passwordHash = await bcrypt.hash('Testing1!', 12);
  const balance = opts.ngnBalanceMinor ?? 1_000_000n * 100n * 10_000n;
  const user = await db.user.create({
    data: {
      email: `user-${Math.random().toString(36).slice(2, 10)}@test.example`,
      passwordHash,
      firstName: 'Test',
      lastName: 'User',
      kyc: { create: { tier: opts.tier ?? 'TIER_2', status: 'APPROVED' } },
      wallets: {
        create: [
          { currency: 'NGN', balanceMinor: balance, settledBalanceMinor: balance },
          { currency: 'USD' },
        ],
      },
    },
  });
  const token = app.jwt.sign({ sub: user.id }, { expiresIn: '5m' });
  return { app, token, userId: user.id };
}

export function naira(n: bigint): bigint {
  return n * 100n * 10_000n;
}

export async function seedHolding(userId: string, fundCode: string, units: string): Promise<void> {
  const fund = await db.fund.findUniqueOrThrow({ where: { code: fundCode } });
  await db.holding.upsert({
    where: { userId_fundId: { userId, fundId: fund.id } },
    create: { userId, fundId: fund.id, units },
    update: { units },
  });
}

export async function seedPendingTransaction(opts: {
  userId: string;
  externalRef: string;
  amountMinor: bigint;
  currency?: 'NGN' | 'USD';
}): Promise<string> {
  const tx = await db.transaction.create({
    data: {
      userId: opts.userId,
      kind: 'TOP_UP_CARD',
      status: 'PENDING',
      currency: opts.currency ?? 'NGN',
      amountMinor: opts.amountMinor,
      externalRef: opts.externalRef,
    },
  });
  return tx.id;
}

export { db, Prisma };
