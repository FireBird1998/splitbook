import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';
import { mcpUnavailableResponse } from '@/lib/mcp/config';

const handlers = toNextJsHandler(auth);
export async function GET(request: Request) {
  return mcpUnavailableResponse(request) ?? handlers.GET(request);
}
export async function POST(request: Request) {
  return mcpUnavailableResponse(request) ?? handlers.POST(request);
}
