import { boundedBody } from '@/lib/draft-http';
import { allowMcpRequest } from '@/lib/mcp/request-limit';
import { registerSplitbookTools } from '@/lib/mcp/tools';
import { auth } from '@/lib/auth';
import { createMcpConnectionHandler } from '@/lib/mcp/connection';
import { mcpResource } from '@/lib/mcp/config';
import { currentMcpGrant } from '@/lib/mcp/grants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
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
      ),
    (server, id, scopes, authorize) =>
      registerSplitbookTools(server, { id, authorize }, scopes, process.env.NEXT_PUBLIC_APP_URL!),
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
