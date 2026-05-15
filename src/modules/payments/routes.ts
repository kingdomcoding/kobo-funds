import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { verifyPayload } from '../../lib/webhookSignature.js';
import { writeAudit } from '../../lib/audit.js';

const WebhookBody = z.object({
  event: z.enum(['payment.succeeded', 'payment.failed']),
  externalRef: z.string().min(8),
  amountMinor: z.coerce.bigint(),
});

type WebhookOutcome = {
  transactionId: string;
  status: 'SETTLED' | 'FAILED';
  replay: boolean;
};

export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhook', async (req, reply) => {
    const sigHeader = req.headers['x-kobo-signature'];
    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (typeof signature !== 'string' || req.rawBody === undefined) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Missing signature');
    }
    if (!verifyPayload(req.rawBody, signature, env.WEBHOOK_HMAC_SECRET)) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Invalid signature');
    }

    const parsed = WebhookBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'VALIDATION', z.prettifyError(parsed.error));
    const body = parsed.data;

    const result = await db.$transaction(async (tx): Promise<WebhookOutcome> => {
      const txn = await tx.transaction.findUnique({ where: { externalRef: body.externalRef } });
      if (!txn) throw new AppError(404, 'NOT_FOUND', 'No transaction for that externalRef');
      if (txn.status === 'SETTLED' || txn.status === 'FAILED') {
        return { transactionId: txn.id, status: txn.status, replay: true };
      }

      const newStatus: 'SETTLED' | 'FAILED' =
        body.event === 'payment.succeeded' ? 'SETTLED' : 'FAILED';

      const updated = await tx.transaction.update({
        where: { id: txn.id },
        data: {
          status: newStatus,
          ...(newStatus === 'SETTLED' ? { settlementDate: new Date() } : {}),
          ...(newStatus === 'FAILED' ? { failedReason: 'Webhook reported failure' } : {}),
        },
      });

      if (newStatus === 'SETTLED' && txn.kind !== 'SUBSCRIPTION' && txn.kind !== 'REDEMPTION') {
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId: txn.userId, currency: txn.currency } },
        });
        if (txn.amountMinor > wallet.balanceMinor - wallet.settledBalanceMinor) {
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { settledBalanceMinor: { increment: txn.amountMinor } },
          });
        }
      }

      await writeAudit({
        tx,
        userId: txn.userId,
        action: `webhook.${body.event}`,
        subject: `tx:${txn.id}`,
        actorType: 'system',
        metadata: { externalRef: body.externalRef, amountMinor: body.amountMinor.toString() },
        requestId: req.id,
      });

      return { transactionId: updated.id, status: newStatus, replay: false };
    });

    return reply.send(result);
  });
}
