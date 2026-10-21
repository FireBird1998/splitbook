import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { requireMcpAuth } from '@better-auth/mcp';
import { z } from 'zod/v4';

import { MCP_DRAFT_SCOPE, MCP_LEDGER_SCOPE } from './config';
import { PRODUCT_NAME } from '@/lib/product';
export { MCP_LEDGER_SCOPE } from './config';

/**
 * Request-scoped transport and token verification. A supplied registrar adds scoped tools.
 * Mounted only when MCP_ENABLED=true.
 * authorize must check current account eligibility and consent, not just JWT expiry.
 */
export function createMcpConnectionHandler(
  auth: Parameters<typeof requireMcpAuth>[0],
  resource: string,
  authorize: (
    subject: string,
    clientId: string,
    generation: unknown,
    scopes: string[],
  ) => Promise<boolean>,
  register?: (
    server: McpServer,
    subject: string,
    scopes: string[],
    authorize: () => Promise<void>,
    clientId: string,
    generation: unknown,
  ) => void | Promise<void>,
  requestCheck?: (subject: string) => Promise<Response | null>,
) {
  const canonical = new URL(resource);
  const protectedHandler = requireMcpAuth(
    auth,
    async (request, claims) => {
      const origin = request.headers.get('origin');
      if (origin && origin !== canonical.origin)
        return Response.json({ error: 'Origin not allowed' }, { status: 403 });
      if (
        typeof claims.sub !== 'string' ||
        typeof claims.client_id !== 'string' ||
        !(await authorize(
          claims.sub,
          claims.client_id,
          claims.splitbook_generation,
          typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
        ))
      )
        return Response.json({ error: 'Connection is no longer authorized' }, { status: 403 });
      const refused = await requestCheck?.(claims.sub);
      if (refused) return refused;
      const handler = createMcpHandler(
        async () => {
          const server = new McpServer({ name: 'splitbook-connection-test', version: '0.1.0' });
          server.registerTool(
            'connection_status',
            {
              title: `Check ${PRODUCT_NAME} connection`,
              description: 'Verify this connection. Returns no Group, expense or member data.',
              inputSchema: z.object({}).strict(),
              annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            },
            async () => ({
              content: [
                {
                  type: 'text',
                  text: register
                    ? `${PRODUCT_NAME} connection verified. Use the tools permitted by your connection.`
                    : `${PRODUCT_NAME} connection verified. Ledger and Draft tools are not enabled in this test.`,
                },
              ],
              structuredContent: { connected: true, mode: 'connection-test' },
            }),
          );
          await register?.(
            server,
            claims.sub!,
            typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
            async () => {
              if (
                !(await authorize(
                  claims.sub!,
                  String(claims.client_id),
                  claims.splitbook_generation,
                  typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
                ))
              )
                throw new Error('FORBIDDEN');
            },
            String(claims.client_id),
            claims.splitbook_generation,
          );
          return server;
        },
        { legacy: 'stateless' },
      );
      const response = await handler.fetch(request);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    },
    {
      resource,
      requiredScopes: [MCP_LEDGER_SCOPE],
      challengeScopes:
        process.env.PERSISTENT_DRAFTS_ENABLED === 'true'
          ? [MCP_LEDGER_SCOPE, MCP_DRAFT_SCOPE]
          : [MCP_LEDGER_SCOPE],
    },
  );
  return async (request: Request) => {
    const response = await protectedHandler(request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
}
