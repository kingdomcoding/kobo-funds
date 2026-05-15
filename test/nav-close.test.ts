import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import { bootApp, db, resetDb, seedFund } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await bootApp();
});

beforeEach(async () => {
  await resetDb();
  await seedFund({ code: 'KMMF' });
  await seedFund({ code: 'KBF', settlementDays: 2, unitPriceMinor: 2_750n * 100n * 10_000n });
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('nav-close (admin)', () => {
  it('rejects without admin token (401)', async () => {
    const res = await supertest(app.server).post('/v1/admin/nav-close');
    expect(res.status).toBe(401);
  });

  it('creates a NavSnapshot per fund and updates Fund.unitPriceMinor', async () => {
    const beforeKmmf = await db.fund.findUniqueOrThrow({ where: { code: 'KMMF' } });
    const res = await supertest(app.server)
      .post('/v1/admin/nav-close')
      .set('X-Admin-Token', process.env.ADMIN_RECONCILE_TOKEN as string);
    expect(res.status).toBe(200);
    expect(res.body.closed).toBe(2);
    const snapshots = await db.navSnapshot.findMany({});
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    const afterKmmf = await db.fund.findUniqueOrThrow({ where: { code: 'KMMF' } });
    expect(afterKmmf.unitPriceMinor).not.toBe(beforeKmmf.unitPriceMinor);
  });
});
