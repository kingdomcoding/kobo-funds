# 4. Double-entry ledger

**Status:** Accepted
**Date:** 2026-05-15

## Context

The MVP shipped with a single-entry `LedgerEntry` table: one row per wallet movement, denormalised `Wallet.balanceMinor` updated alongside. That's adequate for a single-account-per-user platform — but the platform already has more accounts than one:

- Per-user cash wallet (NGN + USD)
- Per-user pending balance (cash credited but not yet settled, e.g. T+N redemptions)
- Per-user holdings in each fund (unit-denominated)
- Bank-suspense account (cash landed via webhook but not yet reconciled)
- Bank-cash account (reconciled cash)
- Total units outstanding per fund (mirror of all user unit balances)

With one canonical "where did the money come from / where did the money go to" recorded per business event, every reconciliation question becomes a `SUM(amount) GROUP BY currency` query that must net to zero. Single-entry collapses here: cash that leaves a user's wallet on a subscription has no recorded counterparty, so you can't *prove* the books balance.

## Decision

Replace the single-entry mental model with classical **double-entry**.

- A new `Account` table represents every place money or units can sit. Accounts are identified by a structured `key` string (e.g. `user:wallet:cmp123:NGN`, `bank:cash:NGN`, `fund:units-outstanding:KMMF`).
- A `JournalEntry` represents one business event (a subscription, a redemption, a top-up, a settlement, a NAV write).
- A `Posting` is a signed amount against an `Account` within a `JournalEntry`. Positive = debit (money flows INTO the account); negative = credit (money flows OUT). The signed convention is symmetric: the sign is purely directional.
- **Invariant.** For any committed `JournalEntry`, the sum of `Posting.amountMinor` per currency must equal zero. This is enforced *before* any DB writes by a `postJournal()` helper.

### Account taxonomy

| Key pattern | Purpose |
|---|---|
| `user:wallet:<userId>:<currency>` | User's available cash |
| `user:wallet-pending:<userId>:<currency>` | Cash earmarked but not yet settled (redemptions in flight) |
| `user:units:<userId>:<fundCode>` | User's fund units (unit-denominated) |
| `bank:suspense:<currency>` | Top-up landed, not yet reconciled |
| `bank:cash:<currency>` | Reconciled cash |
| `fund:units-outstanding:<fundCode>` | Total units issued per fund (mirror of `user:units` for that fund) |

### Postings drive denormalised state

`Wallet.balanceMinor`, `Wallet.settledBalanceMinor`, and `Holding.units` are now *derived* from `Posting` aggregates. The denormalised rows still exist for fast reads, but they are reproducible: a `refreshWalletDenormalised(userId, currency)` helper recomputes them by `SUM(Posting) WHERE account.key = …`.

### Audit trail becomes lossless

Every business event has exactly one `JournalEntry`. Replaying journal entries chronologically from t₀ reconstructs every account balance. Reconciliation reduces to a single SQL query.

## Consequences

**Positive**

- Reconciliation endpoint becomes a trivial query: `SUM(amount_minor) GROUP BY currency` must be zero. If it isn't, there's a bug somewhere; the proof is the query result.
- A `bank:suspense` balance > 0 signals top-ups that landed but weren't settled. A `fund:units-outstanding:<code>` balance plus the sum of all `user:units:*:<code>` should equal zero — drift indicates lost or duplicated unit issuance.
- New external integrations land cleanly: a partner-payout account is just one more account key.
- Property-based testing becomes powerful: any random sequence of valid operations must leave the ledger balanced.

**Negative**

- Every state-changing endpoint is now at least 2 DB inserts where MVP was 1.
- Existing `LedgerEntry` rows need to be backfilled to `Posting` so historical reads stay consistent. We provide a one-shot backfill script and an idempotency guard so it can be re-run safely.
- `Wallet`/`Holding` denormalised refresh is an extra step in every handler. The benefit is debug-friendliness: drift between denormalised and journal-derived balances is itself a signal.

**Trade-offs explicitly named**

- **Why not event-sourcing?** Event sourcing would record domain events (e.g. "subscription requested with amount X") and project them into a read model. Double-entry is a narrower commitment: we only persist money movements, not the full event story. Event sourcing remains an option if we add ops use-cases like "rerun the last 24h with a different fee rule".
- **Why signed amounts instead of explicit `debit`/`credit` columns?** Signed is more compact, and the balance constraint becomes `SUM = 0` instead of `SUM(debit) = SUM(credit)`. Trade-off: readers must mentally map sign to direction.
- **Why include `currency` on every Posting?** Lets us add a future cross-currency journal entry (FX settlement) that nets to zero per currency leg — neither leg is "the currency of the journal".

## Migration plan

1. Add `Account`, `JournalEntry`, `Posting` tables + `AccountKind` enum (additive migration).
2. Add `postJournal()` helper to `src/lib/journal.ts`.
3. Rewrite each handler to post through the helper, one at a time, with the integration test suite asserting no contract change.
4. Backfill historical `LedgerEntry` rows into `Posting` (idempotent script).
5. Add reconciliation endpoint and property-based test asserting `balanced = true`.
6. Keep `LedgerEntry` for now (read-only fallback) — drop in a future ADR.
