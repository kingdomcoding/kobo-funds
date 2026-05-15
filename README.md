# kobo-funds

Reference backend for a SEC-style regulated retail mutual-fund platform. Node.js / TypeScript on Postgres, with realistic KYC, payment, ledger, and audit primitives.

> Active build, started 2026-05-14. Commit graph is the source of truth on progress.

## Live demo

- **API base:** https://kobo-funds.tail4eddd6.ts.net
- **Swagger UI:** https://kobo-funds.tail4eddd6.ts.net/docs
- **Demo credentials:**
  - email: `ada.eze@example.test`
  - password: `DemoPass!2026`

## Why this exists

Built as a reference implementation in the context of applying for a Backend Engineer role at FSDH Asset Management. The goal is to demonstrate, in working code, the patterns a regulated-investment platform needs: idempotent endpoints with body-fingerprint enforcement, KYC tier gating, atomic state changes with transaction-scoped audit rows, settled vs pending wallet balances, unit-price-at-trade capture, and T+N settlement.

## Domain primitives

- **Fund** — a SEC-registered collective investment scheme. Five seeded: money market (KMMF), income (KIF), balanced (KBF), dollar (KDF), halal (KHF).
- **Unit price** — what one unit of a fund is worth at a moment in time. Captured *at the trade* on every subscription.
- **NAV** — net asset value; basis for the unit price. Snapshotted into `NavSnapshot` per fund per day.
- **T+N settlement** — cash leaves the wallet immediately; units are credited at trade; status flips from `PENDING` to `SETTLED` after N business days. Money market is T+0; income T+1; balanced/dollar T+2.
- **KYC tiers** — Tier 0 (no investing), Tier 1 (≤ ₦50k NGN), Tier 2 (≤ ₦500k NGN), Tier 3 (unlimited + USD funds).
- **Audit entry** — append-only row written *inside* the same DB transaction as the state change. Every state-changing endpoint writes one.
- **Idempotency key** — required on every state-changing POST. The middleware fingerprints the request body; reusing the key with a different body returns `409 IDEMPOTENCY_CONFLICT`; reusing with the same body returns the original byte-identical response.

## Architecture at a glance

```
client ──► nginx proxy manager (TLS) ──► fastify API (127.0.0.1:8081)
                                              │
                                              ├─► postgres 16 (Prisma)
                                              ├─► redis 7 (idempotency cache, queues)
                                              └─► BullMQ kyc worker ──► simulated vendor (5s delay)
```

All state-changing endpoints run their work inside a single `db.$transaction(…)` that writes:
- the user-facing `Transaction` row
- the wallet update
- the `LedgerEntry` (single-entry today; migrating to double-entry — see ADR roadmap)
- the `Holding` upsert (on subscriptions)
- the `AuditEntry`

If any step fails, all five roll back together.

## Tech stack

- Node.js 20+, TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Fastify 5 · Zod 4 · Prisma 6 · BullMQ · Pino
- Postgres 16 · Redis 7
- Vitest + Supertest
- Deployed on a single box behind Nginx Proxy Manager with Let's Encrypt TLS

## API surface

- `/healthz`, `/readyz` — liveness/readiness
- `/docs` — Swagger UI; `/docs/json` — OpenAPI 3.1 spec
- `/v1/accounts` — `POST /signup`, `POST /login`, `POST /refresh`, `GET /me`
- `/v1/kyc` — `GET /me`, `POST /initiate` (simulated vendor verifies after 5s)
- `/v1/funds` — `GET /`, `GET /:code` (with 30-day NAV history)
- `/v1/wallet` — `GET /`, `POST /top-up/card` (simulated; `last4=0000` declines)
- `/v1/subscriptions` — `POST /` (KYC-gated, idempotent, T+N settlement)
- `/v1/redemptions` — `POST /` (KYC-gated, idempotent, T+N pending → settled via worker)
- `/v1/payments` — `POST /webhook` (HMAC-verified, idempotent settlement)
- `/v1/holdings` — `GET /` (Decimal-backed valuation; never float)

## Running locally

```bash
docker compose up -d              # Postgres + Redis (mapped to 127.0.0.1:55432 / :56379)
cp .env.example .env              # then `openssl rand -hex 32` twice for the JWT secrets
pnpm install
pnpm prisma migrate dev
pnpm seed
pnpm dev
```

The dev server listens on `http://localhost:3081`. Swagger UI at `http://localhost:3081/docs`.

## Tests

```bash
# one-off: create the test DB
PGPASSWORD=kobo psql -h localhost -p 55432 -U kobo -d postgres -c 'CREATE DATABASE kobo_funds_test;'
pnpm test
```

Suite includes the idempotent-replay test, the body-mismatch 409 test, the KYC ceiling test, the insufficient-funds test, and the T+N settlement-date test.

## Project status

Phase 1 (MVP) shipped 2026-05-14. Roadmap:

- [x] Day 1: redemption flow + webhook HMAC verification + settlement worker
- [ ] Day 2: migrate ledger to double-entry, with reconciliation endpoint (ADR)
- [ ] Day 3: rate limiting per-user, NAV closing job, statement endpoint
- [ ] Week 1: KYC tier feature gates expanded, hash-chained audit log, property-based ledger test
- [ ] Week 2: SOAP integration mock + anti-corruption layer (ADR), OpenTelemetry tracing, performance ADR

## What's simulated

Every external rail in this project is simulated and clearly labelled:

- **Card payments** — a stub; `last4 = '0000'` triggers a decline, anything else succeeds. No real PSP integration.
- **KYC vendor** — a BullMQ delayed job; ~90% approve / 10% reject deterministically by user-id last char. No real BVN/NIN verification.
- **Bank transfers (NIP)** — not implemented yet.
- **NIBSS / VerifyMe / Smile Identity** — only the last 4 digits of BVN/NIN are stored; no real verification is performed.

Do **not** send real BVNs, NINs, card numbers, or money to this API.

## Production deployment (this box)

The API runs on a single production box behind **Tailscale Funnel** at `kobo-funds.tail4eddd6.ts.net` (TLS via Let's Encrypt, managed by Tailscale; no public DNS or cert work to maintain).

```bash
# Generate .env.prod with strong secrets (do not commit)
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api sh -c 'pnpm exec prisma migrate deploy && pnpm exec tsx prisma/seed.ts'

# One-time Tailscale Funnel wiring:
#   tailscale up --hostname=kobo-funds
#   tailscale funnel --bg 8081
```

## Disclaimer

This is a reference implementation. Not affiliated with FSDH, the Nigerian SEC, NIBSS, or any regulated entity. MIT licensed.
