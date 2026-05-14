import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import { ulid } from 'ulid';
import { env } from './config/env.js';
import { loggerOptions } from './lib/logger.js';
import { isAppError } from './lib/errors.js';
import { accountsRoutes } from './modules/accounts/routes.js';
import { fundsRoutes } from './modules/funds/routes.js';
import { holdingsRoutes } from './modules/holdings/routes.js';
import { walletRoutes } from './modules/wallet/routes.js';
import { subscriptionsRoutes } from './modules/subscriptions/routes.js';
import { kycRoutes } from './modules/kyc/routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
    genReqId: () => ulid(),
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true, credentials: false });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'kobo-funds',
        description: 'Reference backend for a SEC-style regulated retail mutual-fund platform.',
        version: '0.1.0',
      },
      servers: [{ url: env.PUBLIC_BASE_URL }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (isAppError(err)) {
      req.log.warn({ err: { code: err.code, message: err.message } }, 'app error');
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, request_id: req.id },
      });
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
    } else {
      req.log.warn({ err }, 'request error');
    }
    return reply.status(status).send({
      error: {
        code: status >= 500 ? 'INTERNAL' : 'VALIDATION',
        message: status >= 500 ? 'Internal server error' : err.message,
        request_id: req.id,
      },
    });
  });

  await app.register(accountsRoutes, { prefix: '/v1/accounts' });
  await app.register(fundsRoutes, { prefix: '/v1/funds' });
  await app.register(holdingsRoutes, { prefix: '/v1/holdings' });
  await app.register(walletRoutes, { prefix: '/v1/wallet' });
  await app.register(subscriptionsRoutes, { prefix: '/v1/subscriptions' });
  await app.register(kycRoutes, { prefix: '/v1/kyc' });

  return app;
}
