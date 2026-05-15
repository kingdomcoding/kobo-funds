import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../lib/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

async function requireAdmin(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const raw = req.headers['x-admin-token'];
  const tok = Array.isArray(raw) ? raw[0] : raw;
  if (typeof tok !== 'string' || tok !== env.ADMIN_RECONCILE_TOKEN) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Admin token required');
  }
}

type ReconcileRow = { currency: 'NGN' | 'USD'; net: bigint | null };

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/nav-close', { preHandler: requireAdmin }, async () => {
    const { closeAllFundNavs } = await import('../../jobs/navClose.js');
    return closeAllFundNavs(db);
  });

  app.get('/reconcile', { preHandler: requireAdmin }, async () => {
    const rows = await db.$queryRaw<ReconcileRow[]>`
      SELECT "currency"::text AS currency, SUM("amountMinor")::bigint AS net
      FROM "Posting"
      GROUP BY "currency"
    `;
    const items = rows.map((r) => {
      const net = r.net ?? 0n;
      return {
        currency: r.currency,
        net: net.toString(),
        balanced: net === 0n,
      };
    });
    return { items, balanced: items.every((i) => i.balanced) };
  });
}
