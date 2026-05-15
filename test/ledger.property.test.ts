import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import {
  bootApp,
  createFundedUser,
  db,
  naira,
  resetDb,
  seedFund,
  seedHolding,
} from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await bootApp();
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

type Op =
  | { kind: 'topup'; amountMinor: bigint }
  | { kind: 'subscribe'; amountMinor: bigint; fund: 'KMMF' | 'KBF' }
  | { kind: 'redeem'; units: string; fund: 'KMMF' };

const opArb = fc.oneof(
  fc.record({
    kind: fc.constant('topup' as const),
    amountMinor: fc.bigInt({ min: 1_000_000n, max: 100_000_000n }),
  }),
  fc.record({
    kind: fc.constant('subscribe' as const),
    amountMinor: fc.bigInt({ min: 1_000_000n, max: 50_000_000n }),
    fund: fc.constantFrom('KMMF' as const, 'KBF' as const),
  }),
  fc.record({
    kind: fc.constant('redeem' as const),
    units: fc.constantFrom('0.10000000', '0.50000000', '1.00000000'),
    fund: fc.constantFrom('KMMF' as const),
  }),
);

async function playOp(token: string, op: Op, keySuffix: string): Promise<void> {
  if (op.kind === 'topup') {
    await supertest(app.server)
      .post('/v1/wallet/top-up/card')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `prop-topup-${keySuffix}`)
      .send({
        currency: 'NGN',
        amountMinor: op.amountMinor.toString(),
        card: { last4: '4242', brand: 'VISA' },
      });
    return;
  }
  if (op.kind === 'subscribe') {
    await supertest(app.server)
      .post('/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `prop-sub-${keySuffix}`)
      .send({ fundCode: op.fund, amountMinor: op.amountMinor.toString() });
    return;
  }
  await supertest(app.server)
    .post('/v1/redemptions')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', `prop-redeem-${keySuffix}`)
    .send({ fundCode: op.fund, units: op.units });
}

describe('ledger invariant (property)', () => {
  it('any sequence of valid ops keeps journal balanced per currency', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 6 }), async (ops) => {
        await resetDb();
        await seedFund({ code: 'KMMF', settlementDays: 0 });
        await seedFund({
          code: 'KBF',
          settlementDays: 2,
          unitPriceMinor: 2_750n * 100n * 10_000n,
        });
        const { token, userId } = await createFundedUser(app, {
          ngnBalanceMinor: naira(10_000_000n),
        });
        await seedHolding(userId, 'KMMF', '50.00000000');
        let i = 0;
        for (const o of ops) {
          await playOp(token, o, `${Date.now()}-${i++}-${Math.random().toString(36).slice(2, 8)}`);
        }
        const recon = await supertest(app.server)
          .get('/v1/admin/reconcile')
          .set('X-Admin-Token', process.env.ADMIN_RECONCILE_TOKEN as string);
        expect(recon.status).toBe(200);
        expect(recon.body.balanced).toBe(true);
      }),
      { numRuns: 10 },
    );
  });
});
