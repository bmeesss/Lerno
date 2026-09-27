import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Success envelope: { data } (spec §14). */
export function sendOk<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data });
}

/** Wraps async handlers so rejections reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
