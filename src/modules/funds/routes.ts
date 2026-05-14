import type { FastifyInstance } from 'fastify';
import type { Fund, NavSnapshot } from '@prisma/client';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';

type SerialisedFund = {
  id: string;
  code: string;
  name: string;
  kind: Fund['kind'];
  currency: Fund['currency'];
  unitPriceMinor: string;
  settlementDays: number;
  isOpen: boolean;
};

function serialiseFund(f: Fund): SerialisedFund {
  return {
    id: f.id,
    code: f.code,
    name: f.name,
    kind: f.kind,
    currency: f.currency,
    unitPriceMinor: f.unitPriceMinor.toString(),
    settlementDays: f.settlementDays,
    isOpen: f.isOpen,
  };
}

function serialiseNav(n: NavSnapshot): { asOf: string; unitPriceMinor: string } {
  return { asOf: n.asOf.toISOString(), unitPriceMinor: n.unitPriceMinor.toString() };
}

export async function fundsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async () => {
    const funds = await db.fund.findMany({
      where: { isOpen: true },
      orderBy: { code: 'asc' },
    });
    return { funds: funds.map(serialiseFund) };
  });

  app.get<{ Params: { code: string } }>('/:code', async (req) => {
    const code = req.params.code.toUpperCase();
    const fund = await db.fund.findUnique({
      where: { code },
      include: {
        navHistory: { orderBy: { asOf: 'desc' }, take: 30 },
      },
    });
    if (!fund) throw new AppError(404, 'NOT_FOUND', 'Fund not found');
    return {
      fund: serialiseFund(fund),
      navHistory: fund.navHistory.map(serialiseNav),
    };
  });
}
