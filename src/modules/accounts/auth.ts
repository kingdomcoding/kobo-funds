import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../lib/db.js';
import { env } from '../../config/env.js';

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
};

export async function issueTokens(app: FastifyInstance, userId: string): Promise<IssuedTokens> {
  const accessToken = app.jwt.sign({ sub: userId }, { expiresIn: env.JWT_ACCESS_TTL });
  const refreshRaw = crypto.randomBytes(48).toString('base64url');
  const refreshHash = crypto.createHash('sha256').update(refreshRaw).digest('hex');
  await db.refreshToken.create({
    data: {
      userId,
      tokenHash: refreshHash,
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return { accessToken, refreshToken: refreshRaw, tokenType: 'Bearer' };
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    await reply.status(401).send({
      error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid token', request_id: req.id },
    });
  }
}
