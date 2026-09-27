/**
 * Lerno MCP server factory (Phase 7 read + Phase 8A write + Phase 8B delete).
 *
 * Builds a per-request MCP server bound to one authenticated user. Tool
 * results are returned as compact JSON text plus structured content; service
 * errors are mapped to MCP tool errors without leaking internals. Destructive
 * tools are never presented as read-only (see annotations in tools.ts).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors.js';
import { mcpTools, type McpContext } from './tools.js';

function toolOk(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function toolFail(code: string, message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `[${code}] ${message}` }],
    isError: true,
  };
}

async function execute(
  run: (ctx: McpContext, args: never) => Promise<Record<string, unknown>>,
  ctx: McpContext,
  args: never,
): Promise<CallToolResult> {
  try {
    return toolOk(await run(ctx, args));
  } catch (err) {
    if (err instanceof ApiError) return toolFail(err.code, err.message);
    if (err instanceof ZodError) return toolFail('VALIDATION_ERROR', 'Invalid tool input');
    console.error('MCP tool error:', err);
    return toolFail('INTERNAL_ERROR', 'Something went wrong');
  }
}

/** Creates an MCP server exposing all Lerno tools for one user. */
export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: 'lerno', version: '0.1.0' });

  for (const tool of Object.values(mcpTools)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
        annotations: tool.annotations,
      },
      // The SDK validates args against the shape above; `never` keeps the
      // per-tool run signatures distinct without unsafe casts of the values.
      (args: Record<string, unknown>) => execute(tool.run, ctx, args as never),
    );
  }

  return server;
}
