import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from './helpers.js';
import { postJournal } from '../src/lib/journal.js';

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('postJournal', () => {
  it('writes balanced postings successfully', async () => {
    await db.$transaction(async (tx) => {
      const result = await postJournal({
        tx,
        memo: 'unit-test balanced',
        postings: [
          { accountKey: 'bank:suspense:NGN', amountMinor: -100n, currency: 'NGN' },
          { accountKey: 'bank:cash:NGN', amountMinor: 100n, currency: 'NGN' },
        ],
      });
      expect(result.journalEntryId).toBeTruthy();
    });
    const postings = await db.posting.findMany();
    expect(postings).toHaveLength(2);
    const accounts = await db.account.findMany();
    expect(accounts.map((a) => a.key).sort()).toEqual(['bank:cash:NGN', 'bank:suspense:NGN']);
  });

  it('rejects unbalanced postings', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await postJournal({
          tx,
          memo: 'should fail',
          postings: [
            { accountKey: 'bank:suspense:NGN', amountMinor: -100n, currency: 'NGN' },
            { accountKey: 'bank:cash:NGN', amountMinor: 50n, currency: 'NGN' },
          ],
        });
      }),
    ).rejects.toThrow(/unbalanced/i);
    const entries = await db.journalEntry.findMany();
    expect(entries).toHaveLength(0);
  });

  it('rejects single-posting journal', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await postJournal({
          tx,
          memo: 'too few',
          postings: [{ accountKey: 'bank:cash:NGN', amountMinor: 0n, currency: 'NGN' }],
        });
      }),
    ).rejects.toThrow(/at least 2/i);
  });

  it('balances per-currency independently', async () => {
    await db.$transaction(async (tx) => {
      await postJournal({
        tx,
        memo: 'multi-currency',
        postings: [
          { accountKey: 'bank:suspense:NGN', amountMinor: -100n, currency: 'NGN' },
          { accountKey: 'bank:cash:NGN', amountMinor: 100n, currency: 'NGN' },
          { accountKey: 'bank:suspense:USD', amountMinor: -50n, currency: 'USD' },
          { accountKey: 'bank:cash:USD', amountMinor: 50n, currency: 'USD' },
        ],
      });
    });
    const ngnSum = await db.posting.aggregate({ where: { currency: 'NGN' }, _sum: { amountMinor: true } });
    const usdSum = await db.posting.aggregate({ where: { currency: 'USD' }, _sum: { amountMinor: true } });
    expect(ngnSum._sum.amountMinor).toBe(0n);
    expect(usdSum._sum.amountMinor).toBe(0n);
  });
});
