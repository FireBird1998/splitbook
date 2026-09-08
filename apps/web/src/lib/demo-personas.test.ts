import { describe, expect, it } from 'vitest';
import {
  DEMO_PERSONA_IDS,
  DEMO_PERSONAS,
  getDemoPersona,
  isDemoPersonaId,
} from '@/lib/demo-personas';

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
      expect(persona.email).toMatch(/@splitbook\.local$/);
      expect(persona.headline.length).toBeGreaterThan(0);
      expect(persona.id).toBe(DEMO_PERSONA_IDS[persona.key]);
    }
  });
});
