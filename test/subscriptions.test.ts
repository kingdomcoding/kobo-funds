import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import { bootApp, createFundedUser, db, naira, resetDb, seedFund } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await bootApp();
});

beforeEach(async () => {
  await resetDb();
  await seedFund({ code: 'KMMF', settlementDays: 0 });
  await seedFund({ code: 'KBF', settlementDays: 2, unitPriceMinor: 2_750n * 100n * 10_000n });
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('subscriptions', () => {
  it('debits wallet and credits holdings on a successful subscription', async () => {
    const { token } = await createFundedUser(app);
    const res = await supertest(app.server)
      .post('/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-test-key-001')
      .send({ fundCode: 'KMMF', amountMinor: naira(5_000n).toString() });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SETTLED');
    expect(res.body.units).toBe('5.00000000');
  });

  it('returns identical body on idempotent replay with same key + body', async () => {
    const { token } = await createFundedUser(app);
    const first = await supertest(app.server)
      .post('/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-test-key-002')
      .send({ fundCode: 'KMMF', amountMinor: naira(3_000n).toString() });
    const second = await supertest(app.server)
      .post('/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-test-key-002')
      .send({ fundCode: 'KMMF', amountMinor: naira(3_000n).toString() });
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
  });

  it('rejects with 409 when same key is reused with a different body', async () => {
    const { token } = await createFundedUser(app);
    await supertest(app.server)
      .post('/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-test-key-003')
      .send({ fundCode: 'KMMF', amountMinor: naira(1_000n).toString() });
    const conflict = await supertest(app.server)
      .post('/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-test-key-003')
      .send({ fundCode: 'KBF', amountMinor: naira(1_000n).toString() });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('rejects with 402 when wallet has insufficient settled balance', async () => {
    const { token } = await createFundedUser(app, { ngnBalanceMinor: naira(100n) });
    const res = await supertest(app.server)
      .post('/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-test-key-004')
      .send({ fundCode: 'KMMF', amountMinor: naira(500n).toString() });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('enforces Tier-1 KYC ceiling on NGN subscriptions', async () => {
    const { token } = await createFundedUser(app, { tier: 'TIER_1' });
    const res = await supertest(app.server)
      .post('/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-test-key-005')
      .send({ fundCode: 'KMMF', amountMinor: naira(100_000n).toString() });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_LIMIT_EXCEEDED');
  });

  it('captures settlement date for T+2 fund', async () => {
    const { token } = await createFundedUser(app);
    const res = await supertest(app.server)
      .post('/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-test-key-006')
      .send({ fundCode: 'KBF', amountMinor: naira(2_750n).toString() });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(new Date(res.body.settlementDate).getTime()).toBeGreaterThan(Date.now());
  });
});
