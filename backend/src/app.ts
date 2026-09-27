import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import type { DbPing } from './controllers/health.controller.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { attachDatabase } from './middleware/auth.js';
import { authRoutes } from './routes/auth.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { profileRoutes } from './routes/profile.routes.js';
import { setRoutes } from './routes/set.routes.js';
import { subjectRoutes } from './routes/subject.routes.js';

export interface AppDeps {
  /** Lightweight optional database probe for /api/health. */
  dbPing?: DbPing;
}

/** Express app factory — kept separate from server startup so tests can mount it. */
export function createApp(deps: AppDeps = {}): Express {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS restricted to known frontend origins (spec §15)
  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin / server-to-server requests (no Origin header).
        if (!origin) {
          callback(null, true);
          return;
        }
        callback(null, config.frontendUrls.includes(origin));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  // Data context: every request gets a database bound to its bearer token.
  app.use(attachDatabase);

  // API routes
  const api = express.Router();
  api.use('/health', healthRoutes(deps.dbPing));
  api.use('/auth', authRoutes());
  api.use('/profile', profileRoutes());
  api.use('/subjects', subjectRoutes());
  api.use('/sets', setRoutes());
  // Feature route groups are mounted here as their phases land.

  app.use('/api', api);

  // Unknown API routes + terminal error handler
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
