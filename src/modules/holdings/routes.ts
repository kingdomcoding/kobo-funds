import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { db } from '../../lib/db.js';
import { requireAuth } from '../accounts/auth.js';

type HoldingItem = {
  fundCode: string;
  fundName: string;
  currency: 'NGN' | 'USD';
  units: string;
  unitPriceMinor: string;
  valueMinor: string;
};

type TotalByCurrency = { currency: 'NGN' | 'USD'; valueMinor: string };

function computeValueMinor(units: Prisma.Decimal, unitPriceMinor: bigint): bigint {
  const priceDec = new Prisma.Decimal(unitPriceMinor.toString());
  const value = units.mul(priceDec).toFixed(0, Prisma.Decimal.ROUND_DOWN);
  return BigInt(value);
}

export async function holdingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireAuth }, async (req) => {
    const userId = req.user.sub;
    const holdings = await db.holding.findMany({
      where: { userId, units: { gt: 0 } },
      include: { fund: true },
    });
    const totals = new Map<'NGN' | 'USD', bigint>();
    const items: HoldingItem[] = holdings.map((h) => {
      const valueMinor = computeValueMinor(h.units, h.fund.unitPriceMinor);
      const prior = totals.get(h.fund.currency) ?? 0n;
      totals.set(h.fund.currency, prior + valueMinor);
      return {
        fundCode: h.fund.code,
        fundName: h.fund.name,
        currency: h.fund.currency,
        units: h.units.toFixed(8),
        unitPriceMinor: h.fund.unitPriceMinor.toString(),
        valueMinor: valueMinor.toString(),
      };
    });
    const totalsArray: TotalByCurrency[] = Array.from(totals.entries()).map(
      ([currency, valueMinor]) => ({ currency, valueMinor: valueMinor.toString() }),
    );
    return { items, totalsByCurrency: totalsArray };
  });
}
