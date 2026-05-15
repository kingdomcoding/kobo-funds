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
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('admin reconcile', () => {
  it('returns balanced: true on empty journal', async () => {
    const res = await supertest(app.server)
      .get('/v1/admin/reconcile')
      .set('X-Admin-Token', process.env.ADMIN_RECONCILE_TOKEN as string);
    expect(res.status).toBe(200);
    expect(res.body.balanced).toBe(true);
  });

  it('stays balanced after a subscription', async () => {
    const { token } = await createFundedUser(app);
    await supertest(app.server)
      .post('/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'recon-test-001-aaaaa')
      .send({ fundCode: 'KMMF', amountMinor: naira(5_000n).toString() });
    const res = await supertest(app.server)
      .get('/v1/admin/reconcile')
      .set('X-Admin-Token', process.env.ADMIN_RECONCILE_TOKEN as string);
    expect(res.status).toBe(200);
    expect(res.body.balanced).toBe(true);
    expect(res.body.items.find((i: { currency: string }) => i.currency === 'NGN')?.net).toBe('0');
  });

  it('rejects without admin token', async () => {
    const res = await supertest(app.server).get('/v1/admin/reconcile');
    expect(res.status).toBe(401);
  });
});
