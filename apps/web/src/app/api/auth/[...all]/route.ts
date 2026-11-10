import { API_CACHE_CONTROL } from '@/lib/api-cache-control';
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';
import { mcpUnavailableResponse } from '@/lib/mcp/config';
import { AuthDatabaseWatch } from '@/lib/mongodb-client';
import { databaseUnavailable } from '@/lib/utils/api-response';

const handlers = toNextJsHandler(auth);

/**
 * Better Auth's answer, unless it failed because the database couldn't be reached: then 503
 * DATABASE_UNAVAILABLE in the words every API uses (#826), rather than Better Auth's bare 500.
 */
async function answer(handle: () => Promise<Response>) {
  const watch = new AuthDatabaseWatch();
  const response = await watch.run(handle);
  if (response.status >= 500 && watch.unreachable !== undefined)
    return databaseUnavailable(watch.unreachable);
  // Function responses can override Next's configured header at the host. Align any cache
  // policy Better Auth emits itself, including session, OAuth token and metadata responses.
  if (response.headers.has('Cache-Control'))
    response.headers.set('Cache-Control', API_CACHE_CONTROL);
  return response;
}

export async function GET(request: Request) {
  return mcpUnavailableResponse(request) ?? answer(() => handlers.GET(request));
}
export async function POST(request: Request) {
  return mcpUnavailableResponse(request) ?? answer(() => handlers.POST(request));
}
