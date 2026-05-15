import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import {
  bootApp,
  createFundedUser,
  db,
  resetDb,
  seedFund,
  seedHolding,
} from './helpers.js';

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

describe('redemptions', () => {
  it('redeems units with T+0 fund and settles immediately', async () => {
    const { token, userId } = await createFundedUser(app);
    await seedHolding(userId, 'KMMF', '50.00000000');
    const res = await supertest(app.server)
      .post('/v1/redemptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-redeem-001-aaaaa')
      .send({ fundCode: 'KMMF', units: '20.00000000' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SETTLED');
    expect(res.body.units).toBe('20.00000000');
  });

  it('rejects redemption when holding is too small (400)', async () => {
    const { token, userId } = await createFundedUser(app);
    await seedHolding(userId, 'KMMF', '5.00000000');
    const res = await supertest(app.server)
      .post('/v1/redemptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-redeem-002-bbbbb')
      .send({ fundCode: 'KMMF', units: '20.00000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects Tier-0 user (403 KYC_REQUIRED)', async () => {
    const { token, userId } = await createFundedUser(app, { tier: 'TIER_0' });
    await seedHolding(userId, 'KMMF', '10.00000000');
    const res = await supertest(app.server)
      .post('/v1/redemptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-redeem-003-ccccc')
      .send({ fundCode: 'KMMF', units: '1.00000000' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_REQUIRED');
  });

  it('returns PENDING and a future settlementDate for T+2 fund', async () => {
    const { token, userId } = await createFundedUser(app);
    await seedHolding(userId, 'KBF', '10.00000000');
    const res = await supertest(app.server)
      .post('/v1/redemptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-redeem-004-ddddd')
      .send({ fundCode: 'KBF', units: '1.00000000' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(new Date(res.body.settlementDate).getTime()).toBeGreaterThan(Date.now());
  });

  it('decrements holding atomically', async () => {
    const { token, userId } = await createFundedUser(app);
    await seedHolding(userId, 'KMMF', '40.00000000');
    await supertest(app.server)
      .post('/v1/redemptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unit-redeem-005-eeeee')
      .send({ fundCode: 'KMMF', units: '15.00000000' });
    const fund = await db.fund.findUniqueOrThrow({ where: { code: 'KMMF' } });
    const remaining = await db.holding.findUniqueOrThrow({
      where: { userId_fundId: { userId, fundId: fund.id } },
    });
    expect(remaining.units.toFixed(8)).toBe('25.00000000');
  });
});
