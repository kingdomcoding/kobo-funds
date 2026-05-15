import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import { signPayload } from '../src/lib/webhookSignature.js';
import {
  bootApp,
  createFundedUser,
  db,
  resetDb,
  seedFund,
  seedPendingTransaction,
} from './helpers.js';

let app: FastifyInstance;
const SECRET = process.env.WEBHOOK_HMAC_SECRET as string;

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

describe('payments webhook', () => {
  it('settles a PENDING transaction on valid signature (200)', async () => {
    const { userId } = await createFundedUser(app);
    const externalRef = `kobo_test_${Date.now()}_a`;
    await seedPendingTransaction({ userId, externalRef, amountMinor: 100_000_000n });
    const body = JSON.stringify({
      event: 'payment.succeeded',
      externalRef,
      amountMinor: '100000000',
    });
    const sig = signPayload(body, SECRET);
    const res = await supertest(app.server)
      .post('/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Kobo-Signature', sig)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SETTLED');
    expect(res.body.replay).toBe(false);
  });

  it('rejects invalid signature with 401', async () => {
    const { userId } = await createFundedUser(app);
    const externalRef = `kobo_test_${Date.now()}_b`;
    await seedPendingTransaction({ userId, externalRef, amountMinor: 100_000_000n });
    const body = JSON.stringify({
      event: 'payment.succeeded',
      externalRef,
      amountMinor: '100000000',
    });
    const res = await supertest(app.server)
      .post('/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Kobo-Signature', 'sha256=deadbeef')
      .send(body);
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown externalRef', async () => {
    const body = JSON.stringify({
      event: 'payment.succeeded',
      externalRef: 'unknown_ref_xyz',
      amountMinor: '100000000',
    });
    const sig = signPayload(body, SECRET);
    const res = await supertest(app.server)
      .post('/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Kobo-Signature', sig)
      .send(body);
    expect(res.status).toBe(404);
  });

  it('replays already-settled transaction as a no-op (replay: true)', async () => {
    const { userId } = await createFundedUser(app);
    const externalRef = `kobo_test_${Date.now()}_c`;
    await seedPendingTransaction({ userId, externalRef, amountMinor: 100_000_000n });
    const body = JSON.stringify({
      event: 'payment.succeeded',
      externalRef,
      amountMinor: '100000000',
    });
    const sig = signPayload(body, SECRET);
    const first = await supertest(app.server)
      .post('/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Kobo-Signature', sig)
      .send(body);
    expect(first.body.replay).toBe(false);
    const second = await supertest(app.server)
      .post('/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Kobo-Signature', sig)
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.replay).toBe(true);
  });
});
