import type { FastifyInstance } from 'fastify';
import { db } from '../../lib/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { requireAuth } from '../accounts/auth.js';

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return s.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

function fmtMoney(currency: 'NGN' | 'USD', minor: bigint): string {
  const major = minor / 1_000_000n;
  const sub = (minor % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  const symbol = currency === 'NGN' ? '₦' : '$';
  return `${symbol}${major.toLocaleString('en')}.${sub}`;
}

export async function statementsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { userId: string; yearMonth: string } }>(
    '/:userId/:yearMonth',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { userId, yearMonth } = req.params;
      const adminHeader = req.headers['x-admin-token'];
      const adminToken = Array.isArray(adminHeader) ? adminHeader[0] : adminHeader;
      const isAdmin =
        typeof adminToken === 'string' && adminToken === env.ADMIN_RECONCILE_TOKEN;
      if (!isAdmin && userId !== req.user.sub) {
        throw new AppError(403, 'FORBIDDEN', 'Can only fetch own statement');
      }
      const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
      if (!m) throw new AppError(400, 'VALIDATION', 'yearMonth must be YYYY-MM');
      const yearStr = m[1];
      const monthStr = m[2];
      if (!yearStr || !monthStr) {
        throw new AppError(400, 'VALIDATION', 'yearMonth must be YYYY-MM');
      }
      const year = Number(yearStr);
      const month = Number(monthStr);
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 1));

      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      const txns = await db.transaction.findMany({
        where: { userId, createdAt: { gte: start, lt: end } },
        include: { fund: true },
        orderBy: { createdAt: 'asc' },
      });
      const wallets = await db.wallet.findMany({ where: { userId } });
      const holdings = await db.holding.findMany({
        where: { userId, units: { gt: 0 } },
        include: { fund: true },
      });

      const txnRows = txns
        .map((t) => {
          const fundCode = t.fund?.code ?? '-';
          const amount = fmtMoney(t.currency, t.amountMinor);
          return `<tr><td>${t.createdAt.toISOString().slice(0, 10)}</td><td>${escapeHtml(t.kind)}</td><td>${escapeHtml(fundCode)}</td><td>${escapeHtml(amount)}</td><td>${escapeHtml(t.status)}</td></tr>`;
        })
        .join('');

      const walletRows = wallets
        .map(
          (w) =>
            `<tr><td>${escapeHtml(w.currency)}</td><td>${escapeHtml(fmtMoney(w.currency, w.balanceMinor))}</td><td>${escapeHtml(fmtMoney(w.currency, w.settledBalanceMinor))}</td></tr>`,
        )
        .join('');

      const holdingRows = holdings
        .map(
          (h) =>
            `<tr><td>${escapeHtml(h.fund.code)}</td><td>${escapeHtml(h.fund.name)}</td><td>${escapeHtml(h.units.toFixed(8))}</td></tr>`,
        )
        .join('');

      const html =
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Statement ${escapeHtml(yearMonth)} — ${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</title>` +
        `<style>body{font-family:system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1rem;color:#111}h1{font-size:1.2rem;margin-bottom:0}h2{font-size:1rem;margin-top:1.5rem}table{width:100%;border-collapse:collapse;margin:.5rem 0 1.5rem}th,td{border-bottom:1px solid #ddd;padding:.4rem;text-align:left;font-size:.9rem}th{background:#f5f5f5}.muted{color:#666;font-size:.85rem}</style></head><body>` +
        `<h1>kobo-funds — Statement of Account</h1>` +
        `<p class="muted">Period: ${escapeHtml(yearMonth)} · Account holder: ${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)} (${escapeHtml(user.email)})</p>` +
        `<h2>Transactions</h2><table><thead><tr><th>Date</th><th>Kind</th><th>Fund</th><th>Amount</th><th>Status</th></tr></thead><tbody>${txnRows || '<tr><td colspan="5" class="muted">No transactions in this period.</td></tr>'}</tbody></table>` +
        `<h2>Closing wallet balances</h2><table><thead><tr><th>Currency</th><th>Balance</th><th>Settled</th></tr></thead><tbody>${walletRows}</tbody></table>` +
        `<h2>Holdings</h2><table><thead><tr><th>Fund</th><th>Name</th><th>Units</th></tr></thead><tbody>${holdingRows || '<tr><td colspan="3" class="muted">No active holdings.</td></tr>'}</tbody></table>` +
        `<p class="muted">Reference implementation. Not a regulated statement.</p>` +
        `</body></html>`;

      return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
    },
  );
}
