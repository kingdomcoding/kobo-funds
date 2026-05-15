import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import supertest from 'supertest';
import { db, resetDb } from './helpers.js';

describe('rate limit', () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('returns 429 when the per-route limit is exceeded', async () => {
    const app = Fastify();
    await app.register(rateLimit, { max: 3, timeWindow: '1 minute' });
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await supertest(app.server).get('/ping');
      statuses.push(res.status);
    }
    await app.close();

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toContain(429);
  });
});
