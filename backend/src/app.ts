import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { healthHandler } from './controllers/health.controller.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

/** Express app factory — kept separate from server startup so tests can mount it. */
export function createApp(): Express {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS restricted to known frontend origins (spec §15)
  app.use(cors({ origin: config.frontendUrls, credentials: true }));

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', healthHandler());

  // Unknown API routes + terminal error handler
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
