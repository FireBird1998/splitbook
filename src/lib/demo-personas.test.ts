import { describe, expect, it } from 'vitest';
import {
  DEMO_PERSONA_IDS,
  DEMO_PERSONAS,
  getDemoPersona,
  isDemoPersonaId,
} from '@/lib/demo-personas';
import { authorizeDemoPersona } from '@/lib/demo-credentials';

describe('demo persona allowlist', () => {
  it('exposes exactly three fixed personas with stable ObjectIds', () => {
    expect(DEMO_PERSONAS).toHaveLength(3);
    expect(DEMO_PERSONA_IDS.alex).toMatch(/^[a-f0-9]{24}$/);
    expect(DEMO_PERSONA_IDS.sam).toMatch(/^[a-f0-9]{24}$/);
    expect(DEMO_PERSONA_IDS.priya).toMatch(/^[a-f0-9]{24}$/);
    expect(new Set(Object.values(DEMO_PERSONA_IDS)).size).toBe(3);
  });

  it('looks up personas by key or id and rejects unknown refs', () => {
    expect(getDemoPersona('alex')?.name).toBe('Alex Rivera');
    expect(getDemoPersona('SAM')?.id).toBe(DEMO_PERSONA_IDS.sam);
    expect(getDemoPersona(DEMO_PERSONA_IDS.priya)?.key).toBe('priya');
    expect(getDemoPersona('unknown')).toBeNull();
    expect(getDemoPersona('')).toBeNull();
    expect(getDemoPersona(null)).toBeNull();
  });

  it('identifies seeded persona ids', () => {
    expect(isDemoPersonaId(DEMO_PERSONA_IDS.alex)).toBe(true);
    expect(isDemoPersonaId('b00000000000000000000001')).toBe(false);
  });

  it('normalises key lookups but keeps id lookups exact', () => {
    // Keys: trimmed + case-insensitive
    expect(getDemoPersona('  sam  ')?.id).toBe(DEMO_PERSONA_IDS.sam);
    expect(getDemoPersona('Priya')?.id).toBe(DEMO_PERSONA_IDS.priya);

    // Ids: exact match only — no case folding
    expect(getDemoPersona(DEMO_PERSONA_IDS.alex.toUpperCase())).toBeNull();
    expect(getDemoPersona(` ${DEMO_PERSONA_IDS.alex} `)?.key).toBe('alex');
  });

  it('gives every persona a name, email, and role headline', () => {
    for (const persona of DEMO_PERSONAS) {
      expect(persona.name.length).toBeGreaterThan(0);
      expect(persona.email).toMatch(/@splitwise\.local$/);
      expect(persona.headline.length).toBeGreaterThan(0);
      expect(persona.id).toBe(DEMO_PERSONA_IDS[persona.key]);
    }
  });
});

describe('authorizeDemoPersona', () => {
  it('returns a session-shaped user for allowlisted personas in demo mode', () => {
    const user = authorizeDemoPersona(
      { personaId: 'alex' },
      { AUTH_MODE: 'demo', NODE_ENV: 'development' },
    );
    expect(user).toEqual({
      id: DEMO_PERSONA_IDS.alex,
      name: 'Alex Rivera',
      email: 'alex.demo@splitwise.local',
      image: null,
    });
  });

  it('rejects unknown personas', () => {
    expect(
      authorizeDemoPersona(
        { personaId: 'hacker' },
        { AUTH_MODE: 'demo', NODE_ENV: 'development' },
      ),
    ).toBeNull();
  });

  it('rejects missing or malformed credentials', () => {
    const env = { AUTH_MODE: 'demo', NODE_ENV: 'development' };

    expect(authorizeDemoPersona(undefined, env)).toBeNull();
    expect(authorizeDemoPersona(null, env)).toBeNull();
    expect(authorizeDemoPersona({}, env)).toBeNull();
    expect(authorizeDemoPersona({ personaId: '' }, env)).toBeNull();
  });

  it('fails closed when demo auth is not allowed', () => {
    expect(
      authorizeDemoPersona(
        { personaId: 'alex' },
        { AUTH_MODE: 'google', NODE_ENV: 'development' },
      ),
    ).toBeNull();
    expect(
      authorizeDemoPersona(
        { personaId: 'alex' },
        { AUTH_MODE: 'demo', NODE_ENV: 'production' },
      ),
    ).toBeNull();
  });
});
