# 6. Rate limit strategy

**Status:** Accepted
**Date:** 2026-05-15

## Context

The MVP shipped with a basic IP-keyed rate limit (60/min across all routes) using `@fastify/rate-limit`. That has two failure modes:

1. **Behind NAT.** All users sharing a corporate or carrier NAT count as one IP and hit the cap collectively.
2. **Brute-force friendly on auth.** A 60/min ceiling on `/v1/accounts/login` is generous enough for a credential-stuffing attempt: an attacker can try a small set of passwords against many usernames without ever tripping the limit.

## Decision

Two buckets, both backed by Redis (shared across server instances):

- **`general` bucket.** 60 requests / minute. Keyed by **user ID** when the request carries a valid JWT; falls back to IP otherwise. Applied globally.
- **`auth` bucket.** 5 requests / minute. Applied per-route on `/v1/accounts/{signup,login,refresh}`. Same key generator (user-id first, IP fallback) — though for these endpoints the user-id is rarely present at the time the limit is evaluated, so it's effectively IP-keyed.

Routes that must never be limited (`/healthz`, `/readyz`) opt out explicitly via `{ config: { rateLimit: false } }`. Loopback (`127.0.0.1`, `::1`) is allow-listed so the test suite and Tailscale Funnel's own health probes aren't throttled.

## Consequences

**Positive**

- Behind-NAT users no longer get collectively throttled.
- Auth surface gets a stricter limit appropriate to its sensitivity (5/min lets a legitimate user retry a typo without locking out, but stops credential-stuffing).
- Redis-backed counters work across multiple server instances if we ever scale out horizontally.
- The keyGenerator is centralised in `src/lib/rateLimit.ts`, so a future change (e.g. add tenant ID to the key) is one file.

**Negative**

- A motivated attacker can still rotate IPs cheaply (Tor, residential proxies). Rate limiting is only one layer; account-lockout-on-N-failures and CAPTCHA are tracked for Day 4+.
- `skipOnError: true` means if Redis goes down, we fall open (no rate limit applied) rather than fail closed. This is intentional: we'd rather degrade availability than reject legitimate traffic on a transient cache outage. But it means a Redis-outage incident is a separate alerting concern.

**Out of scope**

- Burst-tolerant token-bucket semantics. `@fastify/rate-limit` uses a fixed window; for our traffic level this is fine.
- Per-fund or per-endpoint custom limits. Tracked as a Day 4+ refinement once we see real traffic patterns.
- Distributed lock for "exactly once" enforcement under contention. The current implementation can over-count by a small margin under heavy concurrency — acceptable for a soft limit.
