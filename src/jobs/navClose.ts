import type { Prisma, PrismaClient } from '@prisma/client';
import { writeAudit } from '../lib/audit.js';

export async function closeAllFundNavs(
  client: PrismaClient,
  asOf: Date = new Date(),
): Promise<{ closed: number }> {
  const funds = await client.fund.findMany();
  let closed = 0;
  const dayMidnight = new Date(asOf);
  dayMidnight.setUTCHours(0, 0, 0, 0);

  for (const f of funds) {
    const daysSinceLaunch = Math.max(
      1,
      Math.floor((asOf.getTime() - f.createdAt.getTime()) / 86_400_000),
    );
    const wobble = Math.sin(daysSinceLaunch / 5);
    const factorPpm = BigInt(Math.round((1 + 0.001 * wobble) * 1_000_000));
    const newPriceMinor = (f.unitPriceMinor * factorPpm) / 1_000_000n;

    await client.$transaction(async (tx) => {
      await tx.navSnapshot.upsert({
        where: { fundId_asOf: { fundId: f.id, asOf: dayMidnight } },
        create: { fundId: f.id, asOf: dayMidnight, unitPriceMinor: newPriceMinor },
        update: { unitPriceMinor: newPriceMinor },
      });
      await tx.fund.update({
        where: { id: f.id },
        data: { unitPriceMinor: newPriceMinor },
      });
      await writeAudit({
        tx,
        action: 'nav.closed',
        subject: `fund:${f.code}`,
        actorType: 'system',
        metadata: {
          newPriceMinor: newPriceMinor.toString(),
          previousPriceMinor: f.unitPriceMinor.toString(),
          asOf: dayMidnight.toISOString(),
        } satisfies Prisma.InputJsonValue,
      });
    });
    closed++;
  }
  return { closed };
}
