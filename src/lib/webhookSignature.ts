import crypto from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

export function signPayload(body: string, secret: string): string {
  return SIGNATURE_PREFIX + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export function verifyPayload(body: string, header: string, secret: string): boolean {
  if (!header.startsWith(SIGNATURE_PREFIX)) return false;
  const expected = signPayload(body, secret);
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
