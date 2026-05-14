import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { redis } from './redis.js';
import { db } from './db.js';
import { writeAudit } from './audit.js';
import { logger } from './logger.js';

const connection: ConnectionOptions = redis;

export type KycJobData = { userId: string; vendorRef: string };

export const kycQueue = new Queue<KycJobData>('kyc', { connection });

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
