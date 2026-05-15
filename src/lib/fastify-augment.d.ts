import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    idempotency?: { key: string; userId: string | null; requestHash: string };
    rawBody?: string;
  }
}
