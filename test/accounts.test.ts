import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import { bootApp, db, resetDb } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await bootApp();
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('accounts', () => {
  it('signs up a new user, returns tokens, creates kyc + wallets', async () => {
    const res = await supertest(app.server)
      .post('/v1/accounts/signup')
      .send({
        email: 'newuser@test.example',
        password: 'Testing1!',
        firstName: 'New',
        lastName: 'User',
      });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toMatch(/\./);
    expect(res.body.refreshToken).toBeTruthy();

    const user = await db.user.findUniqueOrThrow({
      where: { email: 'newuser@test.example' },
      include: { kyc: true, wallets: true },
    });
    expect(user.kyc?.tier).toBe('TIER_0');
    expect(user.wallets.map((w) => w.currency).sort()).toEqual(['NGN', 'USD']);
  });

  it('rejects duplicate email with 409 EMAIL_TAKEN', async () => {
    await supertest(app.server).post('/v1/accounts/signup').send({
      email: 'dupe@test.example',
      password: 'Testing1!',
      firstName: 'A',
      lastName: 'B',
    });
    const res = await supertest(app.server).post('/v1/accounts/signup').send({
      email: 'dupe@test.example',
      password: 'Testing1!',
      firstName: 'A',
      lastName: 'B',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('logs in with correct password and returns 401 on wrong password', async () => {
    await supertest(app.server).post('/v1/accounts/signup').send({
      email: 'login@test.example',
      password: 'Testing1!',
      firstName: 'A',
      lastName: 'B',
    });
    const ok = await supertest(app.server)
      .post('/v1/accounts/login')
      .send({ email: 'login@test.example', password: 'Testing1!' });
    expect(ok.status).toBe(200);

    const bad = await supertest(app.server)
      .post('/v1/accounts/login')
      .send({ email: 'login@test.example', password: 'WrongPass!' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 on /me without token', async () => {
    const res = await supertest(app.server).get('/v1/accounts/me');
    expect(res.status).toBe(401);
  });
});
