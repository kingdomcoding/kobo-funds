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

const RedeemBody = z
  .object({
    fundCode: z.string().min(2).max(16),
    units: z.string().optional(),
    amountMinor: z.coerce.bigint().optional(),
  })
  .refine((b) => Boolean(b.units) !== Boolean(b.amountMinor !== undefined), {
    message: 'Provide exactly one of units or amountMinor',
  });

export async function redemptionsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    { preHandler: [requireAuth, idempotencyPreHandler] },
    async (req, reply) => {
      const parsed = RedeemBody.safeParse(req.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION', z.prettifyError(parsed.error));
      const body = parsed.data;
      const userId = req.user.sub;
      const idempotency = req.idempotency;
      if (!idempotency) throw new AppError(500, 'INTERNAL', 'Idempotency middleware misconfigured');

      const result = await db.$transaction(async (tx) => {
        const fund = await tx.fund.findUnique({ where: { code: body.fundCode.toUpperCase() } });
        if (!fund || !fund.isOpen) {
          throw new AppError(404, 'FUND_UNAVAILABLE', 'Fund not found or closed for redemptions');
        }
        const holding = await tx.holding.findUnique({
          where: { userId_fundId: { userId, fundId: fund.id } },
        });
        if (!holding) throw new AppError(400, 'VALIDATION', 'No holding in that fund');

        const priceDec = new Prisma.Decimal(fund.unitPriceMinor.toString());
        const units = body.units
          ? new Prisma.Decimal(body.units)
          : new Prisma.Decimal((body.amountMinor as bigint).toString())
              .div(priceDec)
              .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
        if (units.lte(0)) throw new AppError(400, 'VALIDATION', 'Computed units must be positive');
        if (units.gt(holding.units)) {
          throw new AppError(
            400,
            'VALIDATION',
            `Cannot redeem ${units.toFixed(8)}; hold ${holding.units.toFixed(8)}`,
          );
        }

        const amountMinor = BigInt(
          units.mul(priceDec).toFixed(0, Prisma.Decimal.ROUND_DOWN),
        );

        const kyc = await tx.kyc.findUniqueOrThrow({ where: { userId } });
        const kycCheck = checkKycSubscriptionLimit(kyc.tier, amountMinor, fund.currency);
        if (!kycCheck.ok) throw new AppError(403, kycCheck.code, kycCheck.message);

        const settlementDate = addBusinessDays(new Date(), fund.settlementDays);
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId_currency: { userId, currency: fund.currency } },
        });

        const transaction = await tx.transaction.create({
          data: {
            userId,
            fundId: fund.id,
            kind: 'REDEMPTION',
            status: fund.settlementDays === 0 ? 'SETTLED' : 'PENDING',
            currency: fund.currency,
            amountMinor,
            units,
            unitPriceMinor: fund.unitPriceMinor,
            settlementDate,
            idempotencyKey: idempotency.key,
          },
        });

        await tx.holding.update({
          where: { userId_fundId: { userId, fundId: fund.id } },
          data: { units: { decrement: units } },
        });

        const newPending = wallet.balanceMinor + amountMinor;
        const newSettled =
          fund.settlementDays === 0
            ? wallet.settledBalanceMinor + amountMinor
            : wallet.settledBalanceMinor;
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balanceMinor: newPending, settledBalanceMinor: newSettled },
        });
        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            kind: 'REDEMPTION_CREDIT',
            amountMinor,
            balanceAfter: newPending,
            txId: transaction.id,
            reference: `Redemption from ${fund.code}`,
          },
        });

        const unitsScaled = BigInt(
          units.mul(new Prisma.Decimal('1e8')).toFixed(0, Prisma.Decimal.ROUND_DOWN),
        );
        await postJournal({
          tx,
          txId: transaction.id,
          memo: `Retire units ${fund.code} from ${userId}`,
          postings: [
            {
              accountKey: `user:units:${userId}:${fund.code}`,
              amountMinor: -unitsScaled,
              currency: fund.currency,
            },
            {
              accountKey: `fund:units-outstanding:${fund.code}`,
              amountMinor: unitsScaled,
              currency: fund.currency,
            },
          ],
        });
        const cashTargetKey =
          fund.settlementDays === 0
            ? `user:wallet:${userId}:${fund.currency}`
            : `user:wallet-pending:${userId}:${fund.currency}`;
        await postJournal({
          tx,
          txId: transaction.id,
          memo: `Redemption cash ${fund.code} to ${userId}`,
          postings: [
            {
              accountKey: `bank:cash:${fund.currency}`,
              amountMinor: -amountMinor,
              currency: fund.currency,
            },
            { accountKey: cashTargetKey, amountMinor, currency: fund.currency },
          ],
        });

        await writeAudit({
          tx,
          userId,
          action: 'redemption.created',
          subject: `tx:${transaction.id}`,
          metadata: {
            fundCode: fund.code,
            amountMinor: amountMinor.toString(),
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
