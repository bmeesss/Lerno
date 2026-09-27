import type { Request, Response } from 'express';
import { config } from '../config.js';

export type DbPing = () => Promise<void>;

interface HealthPayload {
  status: 'ok' | 'degraded';
  db?: 'ok' | 'error';
  uptimeSeconds: number;
}

/**
 * GET /api/health — lightweight monitoring endpoint (spec §11).
 * Returns the plain { status: "ok" } shape from the spec so uptime monitors can
 * match the body. The optional DB probe is a cheap check behind HEALTH_CHECK_DB.
 */
export function healthHandler(dbPing?: DbPing) {
  return async (_req: Request, res: Response): Promise<void> => {
    const payload: HealthPayload = {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
    };

    if (config.healthCheckDb && dbPing) {
      try {
        await dbPing();
        payload.db = 'ok';
      } catch {
        payload.status = 'degraded';
        payload.db = 'error';
      }
    }

    res.status(payload.status === 'ok' ? 200 : 503).json(payload);
  };
}
