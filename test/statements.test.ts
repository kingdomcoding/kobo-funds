import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import { bootApp, createFundedUser, db, resetDb, seedFund, seedHolding } from './helpers.js';

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

describe('statements', () => {
  it('returns own statement as HTML (200)', async () => {
    const { token, userId } = await createFundedUser(app);
    await seedHolding(userId, 'KMMF', '10.00000000');
    const now = new Date();
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const res = await supertest(app.server)
      .get(`/v1/statements/${userId}/${ym}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Statement of Account');
    expect(res.text).toContain('KMMF');
  });

  it("rejects fetching another user's statement (403)", async () => {
    const a = await createFundedUser(app);
    const b = await createFundedUser(app);
    const now = new Date();
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const res = await supertest(app.server)
      .get(`/v1/statements/${b.userId}/${ym}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(403);
  });

  it('admin token can fetch any statement (200)', async () => {
    const { userId, token } = await createFundedUser(app);
    const now = new Date();
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const res = await supertest(app.server)
      .get(`/v1/statements/${userId}/${ym}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Admin-Token', process.env.ADMIN_RECONCILE_TOKEN as string);
    expect(res.status).toBe(200);
  });

  it('rejects malformed yearMonth (400)', async () => {
    const { token, userId } = await createFundedUser(app);
    const res = await supertest(app.server)
      .get(`/v1/statements/${userId}/not-a-date`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
