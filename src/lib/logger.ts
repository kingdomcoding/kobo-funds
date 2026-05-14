import pino, { type LoggerOptions } from 'pino';
import { env } from '../config/env.js';

const baseOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'passwordHash',
      'bvn',
      'nin',
      'pan',
      'card',
      'card.number',
      '*.password',
      '*.bvn',
      '*.nin',
      '*.pan',
      'authorization',
      'headers.authorization',
      'req.headers.authorization',
    ],
    censor: '[REDACTED]',
  },
};

export const logger = pino(
  env.NODE_ENV === 'development'
    ? { ...baseOptions, transport: { target: 'pino-pretty', options: { colorize: true } } }
    : baseOptions,
);
