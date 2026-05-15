import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { redis } from './redis.js';
import { db } from './db.js';
import { writeAudit } from './audit.js';
import { logger } from './logger.js';

const connection: ConnectionOptions = redis;

export type KycJobData = { userId: string; vendorRef: string };
export type SettlementJobData = Record<string, never>;

export const kycQueue = new Queue<KycJobData>('kyc', { connection });
export const settlementQueue = new Queue<SettlementJobData>('settlement', { connection });

export function startKycWorker(): Worker<KycJobData> {
  const worker = new Worker<KycJobData>(
    'kyc',
    async (job) => {
      const { userId, vendorRef } = job.data;
      const lastChar = userId.charAt(userId.length - 1);
      const ok = lastChar !== '0';
      await db.kyc.update({
        where: { userId },
        data: {
          status: ok ? 'APPROVED' : 'REJECTED',
          tier: ok ? 'TIER_2' : 'TIER_0',
          rejectedReason: ok ? null : 'Simulated mismatch on BVN/NIN verification',
          vendorRef,
        },
      });
      await writeAudit({
        userId,
        action: ok ? 'kyc.approved' : 'kyc.rejected',
        subject: `user:${userId}`,
        actorType: 'system',
        metadata: { vendorRef, simulated: true },
      });
    },
    { connection },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'kyc worker job failed');
  });
  return worker;
}

export function startSettlementWorker(): Worker<SettlementJobData> {
  const worker = new Worker<SettlementJobData>(
    'settlement',
    async () => {
      const due = await db.transaction.findMany({
        where: {
          status: 'PENDING',
          settlementDate: { lte: new Date() },
          kind: { in: ['SUBSCRIPTION', 'REDEMPTION', 'TOP_UP_CARD', 'TOP_UP_NIP'] },
        },
        take: 200,
      });
      for (const t of due) {
        await db.$transaction(async (tx) => {
          await tx.transaction.update({
            where: { id: t.id },
            data: { status: 'SETTLED' },
          });
          if (t.kind === 'REDEMPTION') {
            const wallet = await tx.wallet.findUniqueOrThrow({
              where: { userId_currency: { userId: t.userId, currency: t.currency } },
            });
            await tx.wallet.update({
              where: { id: wallet.id },
              data: { settledBalanceMinor: { increment: t.amountMinor } },
            });
          }
          await writeAudit({
            tx,
            userId: t.userId,
            action: 'settlement.completed',
            subject: `tx:${t.id}`,
            actorType: 'system',
            metadata: { kind: t.kind, amountMinor: t.amountMinor.toString() },
          });
        });
      }
      return { processed: due.length };
    },
    { connection },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'settlement worker job failed');
  });
  return worker;
}
