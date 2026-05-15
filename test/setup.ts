import { execSync } from 'node:child_process';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'fatal';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'b'.repeat(48);
process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? '15m';
process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? '30';
process.env.WEBHOOK_HMAC_SECRET =
  process.env.WEBHOOK_HMAC_SECRET ?? 'c'.repeat(48);
process.env.ADMIN_RECONCILE_TOKEN =
  process.env.ADMIN_RECONCILE_TOKEN ?? 'd'.repeat(32);
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://kobo:kobo@localhost:55432/kobo_funds_test?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:56379';
process.env.PORT = process.env.PORT ?? '3082';
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3082';

execSync('pnpm prisma migrate deploy', {
  stdio: 'inherit',
  env: { ...process.env },
});
