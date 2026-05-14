import { buildApp } from './app.js';
import { env } from './config/env.js';
import { db } from './lib/db.js';
import { redis } from './lib/redis.js';
import { logger } from './lib/logger.js';
import { startKycWorker } from './lib/queue.js';

async function main(): Promise<void> {
  const app = await buildApp();
  const kycWorker = startKycWorker();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      await kycWorker.close();
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
