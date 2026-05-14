import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const db = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
