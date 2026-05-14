import pino, { type Logger, type LoggerOptions } from 'pino';
import { env } from '../config/env.js';

export const loggerOptions: LoggerOptions = {
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
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
};

export const logger: Logger = pino(loggerOptions);
