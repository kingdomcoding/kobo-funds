import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { writeAudit } from '../../lib/audit.js';
import { postJournal } from '../../lib/journal.js';
import { AppError } from '../../lib/errors.js';
import {
  idempotencyPreHandler,
  recordIdempotentResponse,
} from '../../lib/idempotency.js';
import { addBusinessDays, checkKycSubscriptionLimit } from '../../lib/money.js';
import { requireAuth } from '../accounts/auth.js';

const SubscribeBody = z.object({
  fundCode: z.string().min(2).max(16),
  amountMinor: z.coerce.bigint().refine((v) => v > 0n, 'amountMinor must be positive'),
});

export async function subscriptionsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    { preHandler: [requireAuth, idempotencyPreHandler] },
    async (req, reply) => {
      const parsed = SubscribeBody.safeParse(req.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION', z.prettifyError(parsed.error));
      const body = parsed.data;
      const userId = req.user.sub;
      const idempotency = req.idempotency;
      if (!idempotency) throw new AppError(500, 'INTERNAL', 'Idempotency middleware misconfigured');

      const result = await db.$transaction(async (tx) => {
        const fund = await tx.fund.findUnique({ where: { code: body.fundCode.toUpperCase() } });
        if (!fund || !fund.isOpen) {
          throw new AppError(404, 'FUND_UNAVAILABLE', 'Fund not found or closed for subscriptions');
        }

        const kyc = await tx.kyc.findUniqueOrThrow({ where: { userId } });
        const kycCheck = checkKycSubscriptionLimit(kyc.tier, body.amountMinor, fund.currency);
        if (!kycCheck.ok) {
          throw new AppError(403, kycCheck.code, kycCheck.message);
        }

        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId, currency: fund.currency } },
        });
        if (wallet.settledBalanceMinor < body.amountMinor) {
          throw new AppError(
            402,
            'INSUFFICIENT_FUNDS',
            `Insufficient settled balance in ${fund.currency} wallet`,
          );
        }

        const amountDec = new Prisma.Decimal(body.amountMinor.toString());
        const priceDec = new Prisma.Decimal(fund.unitPriceMinor.toString());
        const units = amountDec.div(priceDec).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);

        const settlementDate = addBusinessDays(new Date(), fund.settlementDays);

        const transaction = await tx.transaction.create({
          data: {
            userId,
            fundId: fund.id,
            kind: 'SUBSCRIPTION',
            status: fund.settlementDays === 0 ? 'SETTLED' : 'PENDING',
            currency: fund.currency,
            amountMinor: body.amountMinor,
            units,
            unitPriceMinor: fund.unitPriceMinor,
            settlementDate,
            idempotencyKey: idempotency.key,
          },
        });

        const newBalance = wallet.balanceMinor - body.amountMinor;
        const newSettled = wallet.settledBalanceMinor - body.amountMinor;
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balanceMinor: newBalance, settledBalanceMinor: newSettled },
        });
        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            kind: 'SUBSCRIPTION_DEBIT',
            amountMinor: -body.amountMinor,
            balanceAfter: newBalance,
            txId: transaction.id,
            reference: `Subscription to ${fund.code}`,
          },
        });
        await tx.holding.upsert({
          where: { userId_fundId: { userId, fundId: fund.id } },
          create: { userId, fundId: fund.id, units },
          update: { units: { increment: units } },
        });

        const unitsScaled = BigInt(
          units.mul(new Prisma.Decimal('1e8')).toFixed(0, Prisma.Decimal.ROUND_DOWN),
        );
        await postJournal({
          tx,
          txId: transaction.id,
          memo: `Subscription cash ${fund.code} from ${userId}`,
          postings: [
            {
              accountKey: `user:wallet:${userId}:${fund.currency}`,
              amountMinor: -body.amountMinor,
              currency: fund.currency,
            },
            {
              accountKey: `bank:cash:${fund.currency}`,
              amountMinor: body.amountMinor,
              currency: fund.currency,
            },
          ],
        });
        await postJournal({
          tx,
          txId: transaction.id,
          memo: `Issue units ${fund.code} to ${userId}`,
          postings: [
            {
              accountKey: `fund:units-outstanding:${fund.code}`,
              amountMinor: -unitsScaled,
              currency: fund.currency,
            },
            {
              accountKey: `user:units:${userId}:${fund.code}`,
              amountMinor: unitsScaled,
              currency: fund.currency,
            },
          ],
        });

        await writeAudit({
          tx,
          userId,
          action: 'subscription.created',
          subject: `tx:${transaction.id}`,
          metadata: {
            fundCode: fund.code,
            amountMinor: body.amountMinor.toString(),
            units: units.toString(),
            unitPriceMinor: fund.unitPriceMinor.toString(),
            settlementDate: settlementDate.toISOString(),
          },
          requestId: req.id,
        });

        return { transaction, fundCode: fund.code };
      });

      const payload = {
        transactionId: result.transaction.id,
        fundCode: result.fundCode,
        status: result.transaction.status,
        currency: result.transaction.currency,
        amountMinor: result.transaction.amountMinor.toString(),
        units: result.transaction.units?.toFixed(8) ?? null,
        unitPriceMinor: result.transaction.unitPriceMinor?.toString() ?? null,
        settlementDate: result.transaction.settlementDate?.toISOString() ?? null,
      };
      await recordIdempotentResponse(req, 201, payload);
      return reply.status(201).send(payload);
    },
  );
}
