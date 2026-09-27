/** Structured API errors (spec §14) — one envelope, safe messages only. */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const statusByCode: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = statusByCode[code];
  }
}

export const errors = {
  validation: (message = 'Invalid request') => new ApiError('VALIDATION_ERROR', message),
  unauthorized: (message = 'Authentication required') => new ApiError('UNAUTHORIZED', message),
  forbidden: (message = 'You do not have access to this resource') =>
    new ApiError('FORBIDDEN', message),
  notFound: (message = 'Resource not found') => new ApiError('NOT_FOUND', message),
  conflict: (message = 'Resource already exists') => new ApiError('CONFLICT', message),
  rateLimited: (message = 'Too many requests, please slow down') =>
    new ApiError('RATE_LIMITED', message),
  internal: (message = 'Something went wrong') => new ApiError('INTERNAL_ERROR', message),
};
