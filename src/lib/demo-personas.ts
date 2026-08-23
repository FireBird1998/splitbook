/**
 * Fixed demo personas with stable MongoDB ObjectId strings.
 * Edge-safe — no Node-only imports.
 */

export type DemoPersonaKey = 'alex' | 'sam' | 'priya';

export interface DemoPersona {
  key: DemoPersonaKey;
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: 'organizer' | 'member';
  headline: string;
}

/** Stable ObjectIds used by seed data and Credentials authorize. */
export const DEMO_PERSONA_IDS = {
  alex: 'a00000000000000000000001',
  sam: 'a00000000000000000000002',
  priya: 'a00000000000000000000003',
} as const satisfies Record<DemoPersonaKey, string>;

export const DEMO_GROUP_ID = 'a00000000000000000000010';

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    key: 'alex',
    id: DEMO_PERSONA_IDS.alex,
    name: 'Alex Rivera',
    email: 'alex.demo@splitbook.local',
    image: null,
    role: 'organizer',
    headline: 'Trip organizer · group admin',
  },
  {
    key: 'sam',
    id: DEMO_PERSONA_IDS.sam,
    name: 'Sam Chen',
    email: 'sam.demo@splitbook.local',
    image: null,
    role: 'member',
    headline: 'Trip member',
  },
  {
    key: 'priya',
    id: DEMO_PERSONA_IDS.priya,
    name: 'Priya Shah',
    email: 'priya.demo@splitbook.local',
    image: null,
    role: 'member',
    headline: 'Trip member',
  },
] as const;

const PERSONA_BY_KEY = new Map<string, DemoPersona>(
  DEMO_PERSONAS.map((persona) => [persona.key, persona]),
);

const PERSONA_BY_ID = new Map<string, DemoPersona>(
  DEMO_PERSONAS.map((persona) => [persona.id, persona]),
);

/**
 * Look up a persona by key (e.g. "alex") or by stable ObjectId.
 * Returns null when the value is not on the allowlist.
 */
export function getDemoPersona(personaRef: string | undefined | null): DemoPersona | null {
  if (!personaRef) return null;
  const normalised = personaRef.trim().toLowerCase();
  return PERSONA_BY_KEY.get(normalised) ?? PERSONA_BY_ID.get(personaRef.trim()) ?? null;
}

export function isDemoPersonaId(userId: string | undefined | null): boolean {
  if (!userId) return false;
  return PERSONA_BY_ID.has(userId);
}
