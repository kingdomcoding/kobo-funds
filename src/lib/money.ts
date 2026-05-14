import type { Currency, KycTier } from '@prisma/client';

const KOBO_PER_NAIRA = 100n;
const SCALE = 10_000n;

function naira(n: bigint): bigint {
  return n * KOBO_PER_NAIRA * SCALE;
}

const KYC_LIMITS_NGN: Record<KycTier, bigint | null> = {
  TIER_0: 0n,
  TIER_1: naira(50_000n),
  TIER_2: naira(500_000n),
  TIER_3: null,
};

const KYC_LIMITS_USD: Record<KycTier, bigint | null> = {
  TIER_0: 0n,
  TIER_1: 0n,
  TIER_2: 0n,
  TIER_3: null,
};

export type SubscriptionLimitCheck =
  | { ok: true }
  | { ok: false; code: 'KYC_REQUIRED'; message: string }
  | { ok: false; code: 'KYC_LIMIT_EXCEEDED'; message: string };

export function checkKycSubscriptionLimit(
  tier: KycTier,
  amountMinor: bigint,
  currency: Currency,
): SubscriptionLimitCheck {
  if (tier === 'TIER_0') {
    return { ok: false, code: 'KYC_REQUIRED', message: 'Complete KYC to invest' };
  }
  const limit = currency === 'NGN' ? KYC_LIMITS_NGN[tier] : KYC_LIMITS_USD[tier];
  if (limit !== null && amountMinor > limit) {
    return {
      ok: false,
      code: 'KYC_LIMIT_EXCEEDED',
      message: `KYC ${tier} limit exceeded for ${currency}`,
    };
  }
  return { ok: true };
}

export function addBusinessDays(d: Date, n: number): Date {
  if (n <= 0) return new Date(d);
  const date = new Date(d);
  let added = 0;
  while (added < n) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return date;
}
