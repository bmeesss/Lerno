import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import type { DbPing } from './controllers/health.controller.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { attachDatabase } from './middleware/auth.js';
import { wellKnownRoutes } from './mcp/metadata.js';
import { mcpRoutes } from './mcp/router.js';
import { authRoutes } from './routes/auth.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { profileRoutes } from './routes/profile.routes.js';
import { setRoutes } from './routes/set.routes.js';
import { subjectRoutes } from './routes/subject.routes.js';
import { progressRoutes, reviewRoutes, studyRoutes } from './routes/study.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { discoverRoutes, favoriteRoutes } from './routes/discover.routes.js';
import { adminRoutes, reportRoutes } from './routes/report.routes.js';
import { aiRoutes } from './routes/ai.routes.js';
import { studyPackRoutes } from './routes/study-pack.routes.js';
import { studyProgressRoutes, studySessionRoutes } from './routes/study-session.routes.js';

export interface AppDeps {
  /** Lightweight optional database probe for /api/health. */
  dbPing?: DbPing;
}

/** Express app factory — kept separate from server startup so tests can mount it. */
export function createApp(deps: AppDeps = {}): Express {
  const app = express();

  // One trusted proxy hop (Render TLS termination) so req.ip — and therefore
  // rate limiting — sees the real client IP instead of the proxy's.
  app.set('trust proxy', 1);

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

  // OAuth discovery (RFC 9728) lives at the origin root, outside /api.
  app.use('/.well-known', wellKnownRoutes());

  // API routes
  const api = express.Router();
  api.use('/health', healthRoutes(deps.dbPing));
  api.use('/auth', authRoutes());
  api.use('/profile', profileRoutes());
  api.use('/subjects', subjectRoutes());
  api.use('/sets', setRoutes());
  api.use('/study-packs', studyPackRoutes());
  api.use('/study', studyRoutes());
  api.use('/reviews', reviewRoutes());
  api.use('/progress', progressRoutes());
  api.use('/progress', studyProgressRoutes());
  api.use('/study-sessions', studySessionRoutes());
  api.use('/dashboard', dashboardRoutes());
  api.use('/discover', discoverRoutes());
  api.use('/favorites', favoriteRoutes());
  api.use('/reports', reportRoutes());
  api.use('/admin', adminRoutes());
  api.use('/ai', aiRoutes());
  api.use('/mcp', mcpRoutes());
  // Feature route groups are mounted here as their phases land.

  app.use('/api', api);

  // Unknown API routes + terminal error handler
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
