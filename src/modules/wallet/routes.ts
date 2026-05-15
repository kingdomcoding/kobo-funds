import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { writeAudit } from '../../lib/audit.js';
import { postJournal } from '../../lib/journal.js';
import { AppError } from '../../lib/errors.js';
import {
  idempotencyPreHandler,
  recordIdempotentResponse,
} from '../../lib/idempotency.js';
import { requireAuth } from '../accounts/auth.js';

const CurrencyEnum = z.enum(['NGN', 'USD']);

const TopUpBody = z.object({
  currency: CurrencyEnum,
  amountMinor: z.coerce.bigint().refine((v) => v > 0n, 'amountMinor must be positive'),
  card: z.object({
    last4: z.string().regex(/^\d{4}$/),
    brand: z.enum(['VISA', 'MASTERCARD', 'VERVE']),
  }),
});

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireAuth }, async (req) => {
    const userId = req.user.sub;
    const wallets = await db.wallet.findMany({
      where: { userId },
      orderBy: { currency: 'asc' },
    });
    return {
      wallets: wallets.map((w) => ({
        currency: w.currency,
        balanceMinor: w.balanceMinor.toString(),
        settledBalanceMinor: w.settledBalanceMinor.toString(),
      })),
    };
  });

  app.post(
    '/top-up/card',
    { preHandler: [requireAuth, idempotencyPreHandler] },
    async (req, reply) => {
      const parsed = TopUpBody.safeParse(req.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION', z.prettifyError(parsed.error));
      const body = parsed.data;
      const userId = req.user.sub;
      const idempotency = req.idempotency;
      if (!idempotency) throw new AppError(500, 'INTERNAL', 'Idempotency middleware misconfigured');

      const ok = body.card.last4 !== '0000';
      const externalRef = `kobo_sim_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

      const txResult = await db.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId, currency: body.currency } },
        });

        const transaction = await tx.transaction.create({
          data: {
            userId,
            kind: 'TOP_UP_CARD',
            status: ok ? 'SETTLED' : 'FAILED',
            currency: body.currency,
            amountMinor: body.amountMinor,
            externalRef,
            settlementDate: ok ? new Date() : null,
            idempotencyKey: idempotency.key,
            failedReason: ok ? null : 'Simulated card decline (last4 = 0000)',
          },
        });

        if (ok) {
          const newBalance = wallet.balanceMinor + body.amountMinor;
          const newSettled = wallet.settledBalanceMinor + body.amountMinor;
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balanceMinor: newBalance, settledBalanceMinor: newSettled },
          });
          await tx.ledgerEntry.create({
            data: {
              walletId: wallet.id,
              kind: 'WALLET_FUND_IN',
              amountMinor: body.amountMinor,
              balanceAfter: newBalance,
              txId: transaction.id,
              reference: `Card top-up ****${body.card.last4}`,
            },
          });
          await postJournal({
            tx,
            txId: transaction.id,
            memo: `Top-up card ****${body.card.last4}`,
            postings: [
              {
                accountKey: `bank:suspense:${body.currency}`,
                amountMinor: -body.amountMinor,
                currency: body.currency,
              },
              {
                accountKey: `user:wallet:${userId}:${body.currency}`,
                amountMinor: body.amountMinor,
                currency: body.currency,
              },
            ],
          });
          await writeAudit({
            tx,
            userId,
            action: 'wallet.topup.succeeded',
            subject: `tx:${transaction.id}`,
            metadata: { currency: body.currency, last4: body.card.last4 },
            requestId: req.id,
          });
        } else {
          await writeAudit({
            tx,
            userId,
            action: 'wallet.topup.failed',
            subject: `tx:${transaction.id}`,
            metadata: { reason: 'simulated_decline', last4: body.card.last4 },
            requestId: req.id,
          });
        }

        return transaction;
      });

      const payload = {
        transactionId: txResult.id,
        status: txResult.status,
        externalRef: txResult.externalRef,
        currency: txResult.currency,
        amountMinor: txResult.amountMinor.toString(),
      };
      const status = ok ? 201 : 402;
      await recordIdempotentResponse(req, status, payload);
      return reply.status(status).send(payload);
    },
  );
}
