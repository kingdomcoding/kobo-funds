# 3. Webhook HMAC verification

**Status:** Accepted
**Date:** 2026-05-15

## Context

The `POST /v1/payments/webhook` endpoint receives inbound webhooks from a (simulated) payment service provider that confirm or fail a top-up. Webhooks are unauthenticated by JWT — they originate from an external service, not from a logged-in user — so they need their own authentication primitive. The pattern is industry-standard for fintech: Stripe, Paystack, Flutterwave, and Plaid all use HMAC-signed bodies.

## Decision

Authenticate inbound webhooks with an HMAC-SHA256 of the request body, using a shared secret (`WEBHOOK_HMAC_SECRET`). The signature is sent in an `X-Kobo-Signature` header as `sha256=<hex>`.

Verification is **timing-safe** (`crypto.timingSafeEqual`) to prevent leaking the secret through response-time analysis.

The body that is HMAC'd is the **raw bytes** of the request, captured before Fastify's JSON parser munges it. We register a custom content-type parser that stashes the raw text on `req.rawBody` and then JSON-parses normally for the handler. The verifier uses `req.rawBody`; if a single byte changes (e.g. whitespace, key order), the signature won't match.

## Consequences

**Positive**

- No reliance on TLS for authentication; works even if a proxy adds or strips headers.
- Replay-safe when combined with `externalRef` lookup + the "is this transaction already SETTLED?" idempotency check in the handler.
- Same primitive will reuse for outbound webhooks if we ever notify external systems.
- Constant-time comparison means no leakage of the secret.

**Negative**

- Shared-secret rotation requires coordination with the sender (the PSP). For this MVP, secret rotation is documented but not automated.
- The raw-body parser is a slight foot-gun: any future content-type parser change must preserve the `rawBody` capture, or every webhook will 401.

**Out of scope**

- Per-PSP signature schemes (Stripe uses `t=<ts>,v1=<sig>` with replay-window TTL; Paystack uses a single header). When we integrate a real PSP, we'll add a per-vendor adapter under `src/lib/webhooks/<vendor>.ts` and keep `webhookSignature.ts` as the building block.
- Signature key rotation. Tracked as a Day-4+ item.
