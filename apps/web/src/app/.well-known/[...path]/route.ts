import { auth } from '@/lib/auth';
import { mcpResource } from '@/lib/mcp/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Better Auth owns both issuer-inserted and resource-inserted discovery URLs. */
export async function GET(request: Request) {
  if (!mcpResource()) return new Response(null, { status: 404 });
  return auth.handler(request);
}
