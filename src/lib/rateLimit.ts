import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { redis } from './redis.js';

function userKey(req: FastifyRequest): string {
  const sub = req.user?.sub;
  if (sub) return `u:${sub}`;
  return `ip:${req.ip}`;
}

export async function registerRateLimits(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    redis,
    keyGenerator: userKey,
    max: 60,
    timeWindow: '1 minute',
    skipOnError: true,
    allowList: ['127.0.0.1', '::1'],
  });
}

export const authLimitConfig: RouteShorthandOptions = {
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
};

export const skipRateLimitConfig: RouteShorthandOptions = {
  config: { rateLimit: false },
};
