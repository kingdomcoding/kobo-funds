export type ErrorCode =
  | 'INTERNAL'
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'KYC_REQUIRED'
  | 'KYC_LIMIT_EXCEEDED'
  | 'FUND_UNAVAILABLE'
  | 'INSUFFICIENT_FUNDS'
  | 'PAYMENT_DECLINED';

export class AppError extends Error {
  override readonly name = 'AppError';
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
