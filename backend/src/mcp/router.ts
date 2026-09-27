/**
 * MCP HTTP endpoint (Phase 7).
 *
 * Mounts the Lerno MCP server on the existing Express app using Streamable
 * HTTP in stateless mode: every POST carries its own bearer token, and a
 * fresh server is bound to the verified user for that single request.
 * Authentication and the token-bound database come from the standard
 * middleware (attachDatabase); without a valid identity the request is
 * rejected before any MCP handling runs.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { errors } from '../lib/errors.js';
import { publicRateLimit } from '../middleware/rate-limit.js';
import { backendOrigin, sendMcpUnauthorized } from './metadata.js';
import { mayUseMcp } from './authorization.js';
import { createMcpServer } from './server.js';

export function mcpRoutes(): Router {
  const router = Router();

  router.post(
    '/',
    publicRateLimit,
    asyncHandler(async (req, res) => {
      // Check both the verified identity and the resource audience before
      // exposing any tool. Regular website and other-resource JWTs are not MCP
      // access tokens in Supabase-backed environments.
      if (!mayUseMcp(req.auth)) {
        sendMcpUnauthorized(res, backendOrigin());
        return;
      }
      const userId = req.auth!.id;
      if (req.body === undefined || req.body === null || typeof req.body !== 'object') {
        throw errors.validation('Expected a JSON-RPC object with Content-Type application/json');
      }

      const server = createMcpServer({ userId, db: req.db });
      try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
          void server.close();
        });
        await server.connect(transport);
        // Express augments req with its own `auth` field, which collides with
        // the SDK transport's optional auth type; the transport only reads the
        // underlying HTTP request surface, so this narrowing is safe.
        type McpHttpRequest = Parameters<StreamableHTTPServerTransport['handleRequest']>[0];
        await transport.handleRequest(req as unknown as McpHttpRequest, res, req.body);
      } finally {
        await server.close();
      }
    }),
  );

  // Stateless mode: no SSE streams, no sessions to terminate.
  router.get('/', (_req, res) => {
    const err = errors.methodNotAllowed('Use POST with a JSON-RPC MCP request');
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
  });
  router.delete('/', (_req, res) => {
    const err = errors.methodNotAllowed('MCP sessions are not used; use POST per request');
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
  });

  return router;
}
