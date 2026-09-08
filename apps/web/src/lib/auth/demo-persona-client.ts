/**
 * Client half of the demo persona plugin: types
 * `authClient.demoPersona.signIn({ personaId })` against the server endpoint
 * and refreshes `useSession()` after a successful entry. Browser-safe: the
 * server plugin is imported as a type only.
 */

import type { BetterAuthClientPlugin } from 'better-auth/client';
import type { demoPersona } from '@/lib/auth/demo-persona-plugin';

export const DEMO_PERSONA_SIGN_IN_PATH = '/demo-persona/sign-in';

export const demoPersonaClient = () =>
  ({
    id: 'demo-persona',
    $InferServerPlugin: {} as ReturnType<typeof demoPersona>,
    pathMethods: {
      [DEMO_PERSONA_SIGN_IN_PATH]: 'POST',
    },
    atomListeners: [
      {
        matcher: (path: string) => path === DEMO_PERSONA_SIGN_IN_PATH,
        signal: '$sessionSignal',
      },
    ],
  }) satisfies BetterAuthClientPlugin;
