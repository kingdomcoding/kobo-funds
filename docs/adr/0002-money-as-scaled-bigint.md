# 2. Money as scaled BigInt minor units

**Status:** Accepted
**Date:** 2026-05-14

## Context

Every cash field (wallet balances, transaction amounts, fund unit prices, ledger entries) needs to be:
1. Exact (no float drift)
2. Storable in Postgres without a custom type
3. Computable without crossing into JavaScript `Number`
4. Precise enough to multiply by fractional unit counts without losing kobo (`amountMinor / unitPriceMinor` must not lose precision when the result has 6+ decimal places)

The candidates were:
- **Postgres `numeric` (Prisma `Decimal`)** everywhere
- **JavaScript `bigint`** in scaled minor units
- **String-encoded decimals**

## Decision

Store money as `BigInt` representing the value in **scaled minor units**: 1 unit = 1/10⁴ kobo for NGN, 1/10⁴ cent for USD. So ₦1.00 = 1,000,000 units; $1.00 = 1,000,000 units. The scale (10⁴ over the natural minor unit) gives sub-kobo precision for unit-price math.

Fund-unit counts (`Holding.units`) stay as `Decimal(28,8)` because unit counts are inherently fractional in a way money is not.

Valuation (`units × unitPrice`) uses `Prisma.Decimal` at the boundary, never JavaScript floats:

```
units (Decimal) × unitPriceMinor (BigInt-as-Decimal) → valueMinor (Decimal → BigInt floor)
```

## Consequences

**Positive**

- No float drift, ever. The classic "0.1 + 0.2 = 0.30000000000000004" trap is excluded by construction.
- Postgres `BigInt` columns are cheap and indexable.
- Adding a third currency means picking its natural minor unit (e.g. GHS pesewa) and the same `× 10⁴` scale; nothing else changes.
- Idempotency-key body fingerprinting deterministically serialises BigInt as a string, so retries hash identically.

**Negative**

- JSON serialisation of BigInt is not default; we explicitly call `.toString()` on the wire.
- Developers reading `{ amountMinor: '500000000' }` need to mentally translate to ₦5,000.00. The README's "Domain primitives" section explains the scale. A future helper (`formatNgn(amountMinor)`) could mitigate.
- Mixed BigInt + Decimal arithmetic requires conversions at the boundary. Confined to `src/lib/money.ts` and the holdings/subscriptions modules.

**Out of scope**

- Currency conversion. NGN-vs-USD totals are kept separate (`totalsByCurrency` in `/v1/holdings`). FX-aware totals are flagged for a later phase.
