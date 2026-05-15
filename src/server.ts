import { buildApp } from './app.js';
import { env } from './config/env.js';
import { db } from './lib/db.js';
import { redis } from './lib/redis.js';
import { logger } from './lib/logger.js';
import {
  navQueue,
  settlementQueue,
  startKycWorker,
  startNavWorker,
  startSettlementWorker,
} from './lib/queue.js';

async function main(): Promise<void> {
  const app = await buildApp();
  const kycWorker = startKycWorker();
  const settlementWorker = startSettlementWorker();
  const navWorker = startNavWorker();

  await settlementQueue.add(
    'tick',
    {},
    {
      repeat: { every: 60_000 },
      removeOnComplete: 50,
      removeOnFail: 50,
      jobId: 'settlement-tick',
    },
  );
  await navQueue.add(
    'daily',
    {},
    {
      repeat: { pattern: '0 0 * * 1-5' },
      removeOnComplete: 50,
      removeOnFail: 50,
      jobId: 'nav-daily',
    },
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      await kycWorker.close();
      await settlementWorker.close();
      await navWorker.close();
      await db.$disconnect();
      redis.disconnect();
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'fatal during boot');
  process.exit(1);
});
