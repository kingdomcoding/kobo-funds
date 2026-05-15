# Architecture

## Problem statement

A regulated retail mutual-fund platform has to do five things well, all at once:

1. **Onboard** users with tiered KYC, gated against transaction limits per tier.
2. **Take money in** from card and bank rails with idempotent, replayable webhooks.
3. **Buy and sell fund units** at the price captured *at trade time*, not at settle time.
4. **Maintain a wallet ledger** distinguishing pending from settled balance.
5. **Audit everything** in a way that survives a regulator asking "who did what, when, and why".

All of that has to work with money — meaning every state transition must be atomic, idempotent, and replayable, and every external rail must assume hostile networks.

## Domain primitives

| Term | Meaning | Where it lives |
|---|---|---|
| User | An individual account | `User`, `RefreshToken` |
| KYC tier | Tier 0–3, gates investment limits | `Kyc.tier` |
| Fund | A SEC-style collective investment scheme | `Fund` |
| NAV snapshot | Daily fund unit price | `NavSnapshot` |
| Wallet | Per user × per currency cash account, with pending vs settled split | `Wallet` |
| Ledger entry | Append-only money-movement record | `LedgerEntry` |
| Transaction | User-facing record: top-up, subscription, redemption | `Transaction` |
| Holding | User × fund unit count | `Holding` |
| Audit entry | Append-only "who did what" record | `AuditEntry` |
| Idempotency key | Replayable POST guard with body fingerprint | `IdempotencyKey` |

## Data model summary

```
User ─┬─ Kyc                       (1:1)
      ├─ Wallet [NGN, USD]         (1:N, unique on userId+currency)
      ├─ Holding [per fund]        (1:N, unique on userId+fundId)
      ├─ Transaction               (1:N)
      ├─ RefreshToken              (1:N)
      └─ AuditEntry                (1:N)

Fund ─┬─ NavSnapshot               (1:N, unique on fundId+asOf)
      ├─ Holding                   (1:N)
      └─ Transaction               (1:N)

Wallet ── LedgerEntry              (1:N, append-only)
```

Money everywhere is stored as `BigInt` in **scaled minor units** (NGN: 1 unit = 1/1,000,000 of a naira; USD: 1 unit = 1/1,000,000 of a dollar). Unit prices on `Fund.unitPriceMinor` use the same scale; units held in `Holding.units` are `Decimal(28,8)`. Multiplication for valuation is done with `Prisma.Decimal`, never with JavaScript floats.

A BullMQ settlement worker runs every 60s and flips `PENDING` transactions whose `settlementDate` has passed to `SETTLED`. A payments webhook endpoint accepts HMAC-signed inbound webhooks (PSP confirmations) and idempotently flips `TOP_UP_*` transactions to `SETTLED` or `FAILED`.

## Request lifecycle: a single fund subscription

```
POST /v1/subscriptions
  Idempotency-Key: <key>
  Authorization: Bearer <jwt>
  body: { fundCode, amountMinor }

 1. JWT verify                                    → 401 if invalid
 2. idempotency middleware
      hash request body (SHA-256)
      if key exists:
         method/path/userId/hash mismatch → 409
         match                            → replay original response (byte-identical)
      else: stash {key, userId, hash} on req
 3. db.$transaction(async tx => {
       fund      = tx.fund.findUnique(code)        → 404 if missing/closed
       kyc       = tx.kyc.findUnique(userId)
       checkKycSubscriptionLimit(tier, amount)     → 403 KYC_REQUIRED / KYC_LIMIT_EXCEEDED
       wallet    = tx.wallet.findUnique(user, ccy)
       if settledBalance < amount                  → 402 INSUFFICIENT_FUNDS
       units     = Decimal(amount) / Decimal(unitPrice)
       settleDate = addBusinessDays(today, fund.settlementDays)
       transaction = tx.transaction.create({ amount, units, unitPriceMinor, status, settleDate, idempotencyKey })
       tx.wallet.update({ balance -= amount, settledBalance -= amount })
       tx.ledgerEntry.create({ kind: SUBSCRIPTION_DEBIT, amount: -amount, balanceAfter, txId })
       tx.holding.upsert({ units: { increment: units } })
       writeAudit(tx, action: 'subscription.created', subject: tx:<id>, metadata: {…})
     })
 4. recordIdempotentResponse(key, status, body)
 5. return 201 { transactionId, status, units, unitPriceMinor, settlementDate }
```

If **any** step inside (3) fails, the whole transaction rolls back. The audit row, ledger row, wallet update, holding upsert, and the user-facing Transaction row commit together or not at all.

## Failure modes and how they're handled

| Failure | What the user sees | What the system does |
|---|---|---|
| Network drop, client retries | Identical 201 with same `transactionId` | Replays cached response from `IdempotencyKey` row |
| Client retries with mutated body | `409 IDEMPOTENCY_CONFLICT` | Refuses to re-execute; logs an audit `idempotency.conflict` |
| Two concurrent subscriptions race the same wallet | One succeeds, one gets `402 INSUFFICIENT_FUNDS` | Postgres serialises wallet updates inside the transaction |
| KYC vendor flaps | KYC stays `PENDING_VENDOR` | BullMQ retries the verify job; audit row written on each transition |
| Server crash mid-transaction | Either the row is there or it isn't | Postgres atomicity; no partial writes |
| Reviewer reuses demo wallet | Subscription succeeds, wallet drains | Day-1 cron re-asserts demo balance for the next reviewer |

## Trade-offs explicitly named

- **Single-entry ledger today.** The `LedgerEntry` table is single-entry — each transaction writes one row to the user's wallet. A double-entry refactor is the Day-2 milestone (with an ADR). The reason for shipping single-entry first is that the MVP only has one cash account; the moment we add a bank-suspense or partner-payout account, double-entry becomes correctness-critical.
- **Idempotency at the HTTP layer, not the DB layer.** Stripe's pattern; the alternative would be `INSERT … ON CONFLICT DO NOTHING` on a unique business key. HTTP-layer idempotency wins because it can replay the *response* byte-for-byte without re-executing business logic, and it survives changes to the business logic.
- **Audit inside the same transaction as state changes.** The Prisma `tx` client is passed into `writeAudit`. The alternative would be writing audit rows asynchronously via a queue, which trades replayability for performance. For an MVP with regulator-grade compliance baked into the demo, atomicity wins.
- **Refresh-token rotation, not session cookies.** Refresh tokens are hashed (SHA-256) on the server and rotated on every use. The alternative would be HTTP-only cookies; tokens chosen for parity with the mobile-first FSDHAM app surface.
- **Money as scaled `BigInt` minor units.** 4 extra decimals over kobo/cents gives us sub-kobo precision for unit-price math without losing exactness. The alternative — `Decimal` everywhere — would push precision concerns into every query.
- **JavaScript `Decimal` only at the valuation boundary.** Ledger and wallet math is pure `BigInt`. Only fund-unit valuation (price × units) crosses into Decimal, and only via Prisma's bundled Decimal (no `Number` cast).

## Out of scope for the MVP

- Real PSP integration (Paystack / Flutterwave / NIP)
- Real KYC vendor integration (VerifyMe / Smile Identity / NIBSS)
- Real FX rate provider for the dollar fund
- Real SEC reporting endpoints
- Real NAV computation (mid-day pricing pipeline)
- Real SMS / email / push delivery
- Real admin UI

All of those exist as simulated rails or are stubbed entirely. The README's "What's simulated" section enumerates them.
