import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { db } from './db.js';
import { AppError } from './errors.js';

const IDEMP_TTL_HOURS = 24;

function getRoutePath(req: FastifyRequest): string {
  return req.routeOptions.url ?? req.url;
}

function hashRequestBody(body: unknown): string {
  const serialised = body === undefined ? '' : JSON.stringify(body);
  return crypto.createHash('sha256').update(serialised).digest('hex');
}

export async function idempotencyPreHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const rawKey = req.headers['idempotency-key'];
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key header required (8–128 chars)',
    );
  }
  const userId = req.user?.sub ?? null;
  const requestHash = hashRequestBody(req.body);
  const existing = await db.idempotencyKey.findUnique({ where: { key } });
  if (existing) {
    const same =
      existing.method === req.method &&
      existing.path === getRoutePath(req) &&
      existing.userId === userId &&
      existing.requestHash === requestHash;
    if (!same) {
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key reused for a different request',
      );
    }
    await reply.status(existing.status).send(existing.responseJson);
    return;
  }
  req.idempotency = { key, userId, requestHash };
}

export async function recordIdempotentResponse(
  req: FastifyRequest,
  status: number,
  body: Prisma.InputJsonValue,
): Promise<void> {
  const meta = req.idempotency;
  if (!meta) return;
  await db.idempotencyKey.create({
    data: {
      key: meta.key,
      method: req.method,
      path: getRoutePath(req),
      userId: meta.userId,
      requestHash: meta.requestHash,
      status,
      responseJson: body,
      expiresAt: new Date(Date.now() + IDEMP_TTL_HOURS * 60 * 60 * 1000),
    },
  });
}
