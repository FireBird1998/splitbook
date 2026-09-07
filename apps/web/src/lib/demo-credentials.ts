/**
 * Pure Credentials authorize helper for demo personas.
 * Edge-safe — no Node-only imports.
 */

import { isDemoAuthAllowed, type AuthModeEnv } from '@/lib/auth-mode';
import { getDemoPersona } from '@/lib/demo-personas';

export interface DemoAuthorizeCredentials {
  personaId?: string;
}

export interface DemoAuthUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/**
 * Resolve a demo Credentials sign-in attempt.
 * Returns null when demo auth is disabled or the persona is not allowlisted.
 */
export function authorizeDemoPersona(
  credentials: DemoAuthorizeCredentials | undefined | null,
  env: AuthModeEnv = process.env,
): DemoAuthUser | null {
  if (!isDemoAuthAllowed(env)) return null;

  const persona = getDemoPersona(credentials?.personaId);
  if (!persona) return null;

  return {
    id: persona.id,
    name: persona.name,
    email: persona.email,
    image: persona.image,
  };
}
