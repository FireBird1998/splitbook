/**
 * Demo persona sign-in as a Better Auth server plugin.
 *
 * `POST /api/auth/demo-persona/sign-in` with `{ personaId }` (a persona key
 * such as "alex" or its fixed ObjectId, normalised by `getDemoPersona`) looks
 * the seeded user up by that id, creates a database session for it, sets the
 * session cookie and returns the user — the one-click entry the private beta
 * uses in place of Google.
 *
 * Fail closed, twice: `demoPersonaPluginIfAllowed()` only registers the plugin
 * when `isDemoAuthAllowed()` holds (so the route does not exist in Google mode
 * or in production without `ALLOW_DEMO_AUTH=true`), and the handler re-checks
 * the environment on every call. Persona sign-ins never provision users, so
 * the Google allowlist gate is not involved.
 */

import * as z from 'zod';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { parseUserOutput } from 'better-auth/db';
import { isDemoAuthAllowed, type AuthModeEnv } from '@/lib/auth-mode';
import { getDemoPersona } from '@/lib/demo-personas';

export const DEMO_PERSONA_PLUGIN_ID = 'demo-persona';
export const DEMO_PERSONA_SIGN_IN_PATH = '/demo-persona/sign-in';

/** Ten persona entries per minute from one client; enough for a tester, not for a script. */
export const DEMO_PERSONA_RATE_LIMIT = { window: 60, max: 10 } as const;

export const DEMO_PERSONA_ERROR_CODES = {
  DEMO_PERSONA_NOT_FOUND: {
    code: 'DEMO_PERSONA_NOT_FOUND',
    message: 'Unknown demo persona',
  },
  DEMO_PERSONA_NOT_SEEDED: {
    code: 'DEMO_PERSONA_NOT_SEEDED',
    message: 'Demo persona is not seeded; run pnpm web demo:seed',
  },
} as const;

export const demoPersona = () =>
  ({
    id: DEMO_PERSONA_PLUGIN_ID,
    endpoints: {
      demoPersonaSignIn: createAuthEndpoint(
        DEMO_PERSONA_SIGN_IN_PATH,
        {
          method: 'POST',
          body: z.object({
            personaId: z.string().meta({ description: 'Persona key (alex, sam, priya) or id' }),
          }),
          metadata: {
            openapi: {
              description: 'Sign in as a seeded demo persona (demo mode only)',
              responses: {
                200: {
                  description: 'Session created for the persona',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          token: { type: 'string' },
                          user: { $ref: '#/components/schemas/User' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        async (ctx) => {
          // Env is read at call time so the production guard stays effective
          // even for an instance built while demo mode was allowed.
          if (!isDemoAuthAllowed()) {
            throw APIError.from('NOT_FOUND', DEMO_PERSONA_ERROR_CODES.DEMO_PERSONA_NOT_FOUND);
          }
          const persona = getDemoPersona(ctx.body.personaId);
          if (!persona) {
            throw APIError.from('NOT_FOUND', DEMO_PERSONA_ERROR_CODES.DEMO_PERSONA_NOT_FOUND);
          }
          const user = await ctx.context.internalAdapter.findUserById(persona.id);
          if (!user) {
            throw APIError.from('NOT_FOUND', DEMO_PERSONA_ERROR_CODES.DEMO_PERSONA_NOT_SEEDED);
          }
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            token: session.token,
            user: parseUserOutput(ctx.context.options, user),
          });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path: string) => path === DEMO_PERSONA_SIGN_IN_PATH,
        window: DEMO_PERSONA_RATE_LIMIT.window,
        max: DEMO_PERSONA_RATE_LIMIT.max,
      },
    ],
    $ERROR_CODES: DEMO_PERSONA_ERROR_CODES,
  }) satisfies BetterAuthPlugin;

export type DemoPersonaPlugin = ReturnType<typeof demoPersona>;

/**
 * The plugin, or `null` when demo authentication is not allowed under `env`.
 * Registering nothing is what makes the route answer 404 outside demo mode.
 */
export function demoPersonaPluginIfAllowed(
  env: AuthModeEnv = process.env,
): DemoPersonaPlugin | null {
  return isDemoAuthAllowed(env) ? demoPersona() : null;
}
