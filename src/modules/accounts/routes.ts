import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../../lib/db.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { authLimitConfig } from '../../lib/rateLimit.js';
import { issueTokens, requireAuth } from './auth.js';

const SignupBody = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(64),
  lastName: z.string().min(1).max(64),
  phone: z.string().regex(/^\+?\d{10,15}$/).optional(),
});

const LoginBody = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

const RefreshBody = z.object({
  refreshToken: z.string().min(1),
});

export async function accountsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/signup', authLimitConfig, async (req, reply) => {
    const parsed = SignupBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION', z.prettifyError(parsed.error));
    const body = parsed.data;

    const existing = await db.user.findUnique({ where: { email: body.email } });
    if (existing) throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered');

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await db.user.create({
      data: {
        email: body.email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone ?? null,
        kyc: { create: {} },
        wallets: { create: [{ currency: 'NGN' }, { currency: 'USD' }] },
      },
    });
    await writeAudit({
      userId: user.id,
      action: 'user.signup',
      subject: `user:${user.id}`,
      requestId: req.id,
    });
    const tokens = await issueTokens(app, user.id);
    return reply.status(201).send({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      ...tokens,
    });
  });

  app.post('/login', authLimitConfig, async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION', z.prettifyError(parsed.error));
    const body = parsed.data;

    const user = await db.user.findUnique({ where: { email: body.email } });
    const matches = user !== null && (await bcrypt.compare(body.password, user.passwordHash));
    if (!user || !matches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const tokens = await issueTokens(app, user.id);
    await writeAudit({
      userId: user.id,
      action: 'user.login',
      subject: `user:${user.id}`,
      requestId: req.id,
    });
    return reply.send({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      ...tokens,
    });
  });

  app.post('/refresh', authLimitConfig, async (req, reply) => {
    const parsed = RefreshBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION', z.prettifyError(parsed.error));
    const { refreshToken } = parsed.data;
    const tokenHash = (await import('node:crypto'))
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');
    const record = await db.refreshToken.findUnique({ where: { tokenHash } });
    if (!record || record.revokedAt !== null || record.expiresAt.getTime() < Date.now()) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Refresh token invalid or expired');
    }
    await db.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await issueTokens(app, record.userId);
    return reply.send(tokens);
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const userId = req.user.sub;
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        kyc: { select: { tier: true, status: true } },
        createdAt: true,
      },
    });
    return { user };
  });
}
