import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ulid } from 'ulid';
import { db } from '../../lib/db.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { kycQueue } from '../../lib/queue.js';
import { requireAuth } from '../accounts/auth.js';

const InitiateBody = z.object({
  bvn: z.string().regex(/^\d{11}$/),
  nin: z.string().regex(/^\d{11}$/),
});

const SIMULATED_VENDOR_DELAY_MS = 5_000;

export async function kycRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const userId = req.user.sub;
    const kyc = await db.kyc.findUniqueOrThrow({
      where: { userId },
      select: {
        tier: true,
        status: true,
        bvnLast4: true,
        ninLast4: true,
        vendorRef: true,
        rejectedReason: true,
        updatedAt: true,
      },
    });
    return { kyc };
  });

  app.post('/initiate', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = InitiateBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION', z.prettifyError(parsed.error));
    const body = parsed.data;
    const userId = req.user.sub;
    const vendorRef = `kobo_kyc_${ulid()}`;

    await db.kyc.update({
      where: { userId },
      data: {
        status: 'PENDING_VENDOR',
        bvnLast4: body.bvn.slice(-4),
        ninLast4: body.nin.slice(-4),
        vendorRef,
      },
    });
    await writeAudit({
      userId,
      action: 'kyc.initiated',
      subject: `user:${userId}`,
      metadata: { vendorRef },
      requestId: req.id,
    });

    await kycQueue.add(
      'verify',
      { userId, vendorRef },
      { delay: SIMULATED_VENDOR_DELAY_MS, removeOnComplete: true, removeOnFail: 100 },
    );

    return reply.status(202).send({
      status: 'PENDING_VENDOR',
      vendorRef,
      estimatedSettlementMs: SIMULATED_VENDOR_DELAY_MS,
    });
  });
}
