import type { Prisma, PrismaClient } from '@prisma/client';
import { db } from './db.js';

export type AuditActorType = 'user' | 'system' | 'admin';

export type AuditInput = {
  userId?: string | null;
  action: string;
  subject: string;
  actorType?: AuditActorType;
  metadata?: Prisma.InputJsonValue;
  requestId?: string;
  tx?: Prisma.TransactionClient | PrismaClient;
};

export async function writeAudit(input: AuditInput): Promise<void> {
  const client = input.tx ?? db;
  await client.auditEntry.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      subject: input.subject,
      actorType: input.actorType ?? 'user',
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      requestId: input.requestId ?? null,
    },
  });
}
