import { connectedAssistantName } from '@/lib/mcp/assistant-name';
import { boundedBody } from '@/lib/draft-http';
import { allowMcpRequest } from '@/lib/mcp/request-limit';
import { registerSplitbookTools } from '@/lib/mcp/tools';
import { auth } from '@/lib/auth';
import { createMcpConnectionHandler } from '@/lib/mcp/connection';
import { mcpResource, mcpUnavailableResponse } from '@/lib/mcp/config';
import { currentMcpGrant } from '@/lib/mcp/grants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const unavailable = mcpUnavailableResponse(request);
  if (unavailable) return unavailable;
  const resource = mcpResource();
  if (!resource) return new Response(null, { status: 404 });
  let body: string;
  try {
    body = await boundedBody(request);
  } catch {
    return Response.json(
      { error: 'Request too large' },
      { status: 413, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const boundedRequest = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body,
  });
  const handler = createMcpConnectionHandler(
    auth,
    resource,
    async (userId, clientId, generation, scopes) =>
      currentMcpGrant(
        (await auth.$context).adapter,
        process.env,
        userId,
        clientId,
        generation,
        scopes,
        true,
      ),
    async (server, id, scopes, authorize, clientId) =>
      registerSplitbookTools(
        server,
        {
          id,
          authorize,
          assistant: {
            name: await connectedAssistantName((await auth.$context).adapter, clientId),
          },
        },
        scopes,
        process.env.NEXT_PUBLIC_APP_URL!,
      ),
    async (subject) =>
      (await allowMcpRequest(subject))
        ? null
        : Response.json(
            { error: 'Too many requests. Try again in a minute.' },
            { status: 429, headers: { 'Retry-After': '60' } },
          ),
  );
  return handler(boundedRequest);
}

// GET keeps its normal 405, but reports the same MCP outage as POST when misconfigured.
export async function GET(request: Request) {
  return (
    mcpUnavailableResponse(request) ??
    new Response(null, { status: 405, headers: { Allow: 'POST' } })
  );
}
