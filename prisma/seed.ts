import { PrismaClient, type FundKind, type Currency } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

type FundSeed = {
  code: string;
  name: string;
  kind: FundKind;
  currency: Currency;
  unitPriceMinor: bigint;
  settlementDays: number;
};

const NAIRA_SCALED = 100n * 10_000n;
const DOLLAR_SCALED = 100n * 10_000n;

const FUNDS: FundSeed[] = [
  {
    code: 'KMMF',
    name: 'Kobo Money Market Fund',
    kind: 'MONEY_MARKET',
    currency: 'NGN',
    unitPriceMinor: 1_000n * NAIRA_SCALED,
    settlementDays: 0,
  },
  {
    code: 'KIF',
    name: 'Kobo Income Fund',
    kind: 'INCOME',
    currency: 'NGN',
    unitPriceMinor: 1_250n * NAIRA_SCALED,
    settlementDays: 1,
  },
  {
    code: 'KBF',
    name: 'Kobo Balanced Fund',
    kind: 'BALANCED',
    currency: 'NGN',
    unitPriceMinor: 2_750n * NAIRA_SCALED,
    settlementDays: 2,
  },
  {
    code: 'KDF',
    name: 'Kobo Dollar Fund',
    kind: 'DOLLAR',
    currency: 'USD',
    unitPriceMinor: 100n * DOLLAR_SCALED,
    settlementDays: 2,
  },
  {
    code: 'KHF',
    name: 'Kobo Halal Fund',
    kind: 'HALAL',
    currency: 'NGN',
    unitPriceMinor: 1_100n * NAIRA_SCALED,
    settlementDays: 1,
  },
];

const DEMO_EMAIL = 'ada.eze@example.test';
const DEMO_PASSWORD = 'DemoPass!2026';
const DEMO_NGN_BALANCE = 250_000n * NAIRA_SCALED;

async function upsertFunds(): Promise<void> {
  for (const f of FUNDS) {
    await db.fund.upsert({
      where: { code: f.code },
      create: f,
      update: {
        name: f.name,
        kind: f.kind,
        currency: f.currency,
        unitPriceMinor: f.unitPriceMinor,
        settlementDays: f.settlementDays,
      },
    });
  }
}

async function upsertDemoUser(): Promise<string> {
  const existing = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) return existing.id;
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const user = await db.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash,
      firstName: 'Ada',
      lastName: 'Eze',
      phone: '+2348012345678',
      kyc: {
        create: {
          status: 'APPROVED',
          tier: 'TIER_2',
          bvnLast4: '4321',
          ninLast4: '8765',
        },
      },
      wallets: {
        create: [
          {
            currency: 'NGN',
            balanceMinor: DEMO_NGN_BALANCE,
            settledBalanceMinor: DEMO_NGN_BALANCE,
          },
          { currency: 'USD' },
        ],
      },
    },
  });
  return user.id;
}

async function seedDemoHolding(userId: string): Promise<void> {
  const kmmf = await db.fund.findUniqueOrThrow({ where: { code: 'KMMF' } });
  const existing = await db.holding.findUnique({
    where: { userId_fundId: { userId, fundId: kmmf.id } },
  });
  if (existing) return;
  await db.holding.create({
    data: {
      userId,
      fundId: kmmf.id,
      units: '100.00000000',
    },
  });
}

async function seedNavHistory(): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const funds = await db.fund.findMany();
  for (const fund of funds) {
    for (let i = 30; i >= 1; i--) {
      const asOf = new Date(today);
      asOf.setUTCDate(today.getUTCDate() - i);
      const wobble = wobblePrice(fund.unitPriceMinor, i);
      await db.navSnapshot.upsert({
        where: { fundId_asOf: { fundId: fund.id, asOf } },
        create: { fundId: fund.id, asOf, unitPriceMinor: wobble },
        update: { unitPriceMinor: wobble },
      });
    }
  }
}

function wobblePrice(base: bigint, daysAgo: number): bigint {
  const noise = Math.sin(daysAgo / 4) * 0.005;
  const factor = BigInt(Math.round((1 + noise) * 1_000_000));
  return (base * factor) / 1_000_000n;
}

async function main(): Promise<void> {
  console.log('seeding funds…');
  await upsertFunds();
  console.log('seeding demo user…');
  const userId = await upsertDemoUser();
  console.log('seeding demo holding…');
  await seedDemoHolding(userId);
  console.log('seeding nav history…');
  await seedNavHistory();
  console.log(`✓ seed complete (demo: ${DEMO_EMAIL} / ${DEMO_PASSWORD})`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
