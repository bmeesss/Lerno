/** Structured API errors (spec §14) — one envelope, safe messages only. */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'AI_ERROR'
  | 'AI_TIMEOUT'
  | 'INTERNAL_ERROR';

const statusByCode: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  AI_ERROR: 502,
  AI_TIMEOUT: 504,
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
  methodNotAllowed: (message = 'Method not allowed') => new ApiError('METHOD_NOT_ALLOWED', message),
  conflict: (message = 'Resource already exists') => new ApiError('CONFLICT', message),
  rateLimited: (message = 'Too many requests, please slow down') =>
    new ApiError('RATE_LIMITED', message),
  /** Lerno AI is not configured (no GROQ_API_KEY) — safe, pre-checked message. */
  aiUnavailable: (message = 'The AI is temporarily unavailable. Please try again in a moment.') =>
    new ApiError('AI_UNAVAILABLE', message),
  /** The AI provider failed — generic message, never leaks upstream details. */
  aiError: (message = 'The AI is temporarily unavailable. Please try again in a moment.') =>
    new ApiError('AI_ERROR', message),
  /** The AI provider did not answer in time. */
  aiTimeout: (message = 'The AI took too long to answer. Please try again.') =>
    new ApiError('AI_TIMEOUT', message),
  internal: (message = 'Something went wrong') => new ApiError('INTERNAL_ERROR', message),
};
