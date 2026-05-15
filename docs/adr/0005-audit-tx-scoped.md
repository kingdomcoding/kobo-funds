# 5. Audit rows written inside the same DB transaction as state changes

**Status:** Accepted
**Date:** 2026-05-15 (retroactive — choice made during MVP)

## Context

Every state-changing endpoint writes a row to `AuditEntry` describing what happened. Two patterns were considered:

1. **Async audit via queue.** Handlers enqueue an audit message; a worker consumes and writes the row. Less DB pressure on the hot path; eventual consistency.
2. **Inline audit, same DB transaction.** The audit row is created inside the same `db.$transaction(...)` block as the state change. If the state change rolls back, so does the audit row; if it commits, the audit row commits atomically with it.

## Decision

Option 2. The `writeAudit()` helper accepts an optional `tx` parameter (the active Prisma transaction client). Every handler that mutates state passes `tx`; every handler completes the state mutation and the audit write inside one `$transaction`.

## Consequences

**Positive**

- The audit log is **lossless** with respect to committed state. Any state visible in `Wallet`/`Holding`/`Transaction` has a matching `AuditEntry`. No reconciliation needed between the two.
- A regulator-grade question — "show me every event that touched user X's wallet on date Y" — is answered by `SELECT * FROM AuditEntry WHERE userId = X AND createdAt BETWEEN ...`, with confidence that nothing was lost in transit.
- No queue infrastructure required for audit. Audit reliability is decoupled from worker uptime.
- Transaction rollback (e.g. due to a constraint violation deep in the handler) cleanly removes the audit row, so we never have "phantom" audit entries for state that didn't actually change.

**Negative**

- Audit writes are on the request-latency path. For high-throughput services this would be a bottleneck; for this platform's expected traffic profile it's fine.
- `AuditEntry` is on the same DB as everything else. If we ever shard, we'd need a strategy (probably: audit goes into a partition keyed by `userId`).

**Trade-offs explicitly named**

- **What about audit-immutability?** Postgres lets you `UPDATE`/`DELETE` rows in `AuditEntry`. Application code never does so, but a compromised DB role could. The mitigation (planned for Day 4+) is a hash-chained audit log: each row's hash includes the previous row's hash, so any tampering is detectable. That's tracked as ADR 0007 (or thereabouts) and doesn't change the tx-scoped write semantics.
