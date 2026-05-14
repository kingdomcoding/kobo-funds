import type { FastifyInstance } from 'fastify';
import { db } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_req, reply) => {
    const checks: Record<string, 'ok' | 'fail'> = { db: 'fail', redis: 'fail' };
    try {
      await db.$queryRaw`SELECT 1`;
      checks.db = 'ok';
    } catch {
      // db remains 'fail'
    }
    try {
      const pong = await redis.ping();
      if (pong === 'PONG') checks.redis = 'ok';
    } catch {
      // redis remains 'fail'
    }
    const ready = checks.db === 'ok' && checks.redis === 'ok';
    return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks });
  });
}
