# Domain glossary

## Identity / KYC

- **BVN — Bank Verification Number.** 11-digit Nigerian banking identity issued by NIBSS. We store only the last 4 digits.
- **NIN — National Identification Number.** 11-digit Nigerian government identity. Same storage policy.
- **KYC — Know Your Customer.** Regulator-mandated identity verification. We model four tiers.
- **KYC tier ceilings** (in this implementation):
  - Tier 0: no investing
  - Tier 1: ≤ ₦50,000 per subscription
  - Tier 2: ≤ ₦500,000 per subscription
  - Tier 3: unlimited NGN and dollar-fund access

## Money rails

- **NIP — NIBSS Instant Payment.** The dominant Nigerian bank-transfer rail. Simulated only.
- **PSP — Payment Service Provider.** Card-acquiring stack (Paystack, Flutterwave, Interswitch). Simulated only.
- **kobo** — minor unit of the naira (1 NGN = 100 kobo). We store in **scaled** minor units: 1 unit = 1/10⁴ kobo = 1/10⁶ NGN.
- **cents** — minor unit of the dollar. Same scaling.

## Investing primitives

- **AUM — Assets Under Management.** Sum of all unit-counts × current unit price, per fund.
- **NAV — Net Asset Value.** What one unit of the fund is worth at a given point in time. We snapshot daily.
- **Unit price** — the NAV figure used for a specific trade. Captured at trade time on every subscription/redemption so settlement uses the trade-time price.
- **Subscription** — the user buying units of a fund.
- **Redemption** — the user selling units back for cash (not in MVP).
- **T+N settlement** — settlement happens N business days after trade. Money market T+0; income T+1; balanced & dollar T+2.

## Wallet semantics

- **Balance** — total cash credited to the wallet, including pending top-ups.
- **Settled balance** — cash actually cleared and available for new subscriptions.
- **Available balance** — synonym for settled balance in the user-facing UI; not modelled separately.

## Regulatory references

- **SEC** — Nigerian Securities and Exchange Commission. Registers collective investment schemes; we model SEC-style fund taxonomy.
- **NDPR** — Nigeria Data Protection Regulation. Drives PII redaction in logs (BVN, NIN, PAN, card last4 redacted at logger level).
- **AML** — Anti-Money Laundering. The KYC tier gating is the AML control surface.
- **ISA** — Investments and Securities Act. Section 160 frames mutual-fund authorisation; not modelled explicitly.

## Infrastructure terms

- **Idempotency key** — a client-chosen identifier that lets a state-changing POST be safely retried. We enforce body-fingerprint matching: same key with a different body returns `409`.
- **Audit entry** — append-only row capturing a state transition (`action`, `subject`, `actorType`, `metadata`, `requestId`). Written *inside* the same DB transaction as the state change.
- **Request ID** — ULID generated per request. Propagates into the audit row, the log line, and the error response envelope.
- **Refresh token** — long-lived token, SHA-256-hashed at rest, rotated on every use.
