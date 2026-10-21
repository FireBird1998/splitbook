import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { z } from 'zod';
import { endCurrentSession } from '@/lib/auth/end-session';

/** End only this session; the signed request returns to consent, never to authorize/continue. */
export const switchMcpAccount = createAuthEndpoint(
  '/mcp/switch-account',
  {
    method: 'POST',
    use: [sessionMiddleware],
    // No caller-supplied destination: the sole return route is our approval page.
    body: z.object({ oauth_query: z.string().min(1).max(16000) }).strict(),
  },
  async (ctx) => {
    if (!(await verifyOAuthQueryParams(ctx.body.oauth_query, ctx.context.secret)))
      throw new APIError('BAD_REQUEST', {
        message: 'This connection request is invalid or expired. Restart from your assistant.',
      });
    await endCurrentSession(ctx);
    deleteSessionCookie(ctx);
    ctx.setHeader('Cache-Control', 'no-store');
    return ctx.json({
      url: `/login?${new URLSearchParams({ callbackUrl: `/mcp/consent?${ctx.body.oauth_query}` })}`,
    });
  },
);
