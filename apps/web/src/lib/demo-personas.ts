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

/**
 * The Groups the demo seed adds beside the Goa trip, for the web portal (#302). Kept clear of
 * the mobile fixture Groups (`…020` Maple House, `…030` Alex's private Group) and of `…099`,
 * which the mobile verifiers use as an id that matches nothing.
 */
export const DEMO_HOUSEHOLD_ID = 'a00000000000000000000201';
export const DEMO_WEEK_TRIP_ID = 'a00000000000000000000202';
export const DEMO_WORK_GROUP_ID = 'a00000000000000000000203';

/** Every Group the demo seed creates; `demo:reset` removes exactly these and their records. */
export const DEMO_SEEDED_GROUP_IDS = [
  DEMO_GROUP_ID,
  DEMO_HOUSEHOLD_ID,
  DEMO_WEEK_TRIP_ID,
  DEMO_WORK_GROUP_ID,
] as const;

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
