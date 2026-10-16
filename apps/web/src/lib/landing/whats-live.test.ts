import { describe, expect, it } from 'vitest';
import { whatsLive } from './whats-live';

/*
 * #444: the one description of what this deployment has live, which decides what the landing
 * page may say. Everything is off unless its setting turns it on.
 */

const APP = { NEXT_PUBLIC_APP_URL: 'https://splitbook.example.test/' };
const PLAY = 'https://play.google.com/store/apps/details?id=com.splitbook.app';

describe("what's live", () => {
  it('has everything off with no settings', () => {
    expect(whatsLive({})).toEqual({
      assistants: { available: false, prepare: false },
      playStoreUrl: null,
      pricingVisible: false,
      links: { privacy: null, terms: null, support: null },
    });
  });

  it('has assistants available only when the assistant connection is on and configured', () => {
    expect(whatsLive({ ...APP, MCP_ENABLED: 'true' }).assistants).toEqual({
      available: true,
      prepare: false,
    });
    expect(whatsLive({ ...APP, MCP_ENABLED: 'false' }).assistants.available).toBe(false);
    // A misconfigured connection is not live: an app address the connection refuses.
    expect(
      whatsLive({ NEXT_PUBLIC_APP_URL: 'http://splitbook.example.test/', MCP_ENABLED: 'true' })
        .assistants.available,
    ).toBe(false);
    expect(whatsLive({ MCP_ENABLED: 'true' }).assistants.available).toBe(false);
  });

  it('lets assistants prepare items only when they are available and To review is on', () => {
    const on = { ...APP, MCP_ENABLED: 'true', PERSISTENT_DRAFTS_ENABLED: 'true' };
    expect(whatsLive(on).assistants).toEqual({ available: true, prepare: true });
    expect(whatsLive({ PERSISTENT_DRAFTS_ENABLED: 'true' }).assistants).toEqual({
      available: false,
      prepare: false,
    });
  });

  it('takes a Google Play listing address, and ignores anything else', () => {
    expect(whatsLive({ NEXT_PUBLIC_PLAY_STORE_URL: PLAY }).playStoreUrl).toBe(PLAY);
    expect(whatsLive({ NEXT_PUBLIC_PLAY_STORE_URL: ` ${PLAY} ` }).playStoreUrl).toBe(PLAY);
    for (const other of [
      'http://play.google.com/store/apps/details?id=com.splitbook.app',
      'https://play.google.com.example.test/store/apps/details?id=com.splitbook.app',
      'https://play.google.com/store/apps/details',
      'https://example.test/app',
      'javascript:alert(1)',
      'not a url',
      '',
    ])
      expect(whatsLive({ NEXT_PUBLIC_PLAY_STORE_URL: other }).playStoreUrl, other).toBeNull();
  });

  it('shows pricing only when its setting is on', () => {
    expect(whatsLive({ LANDING_PRICING_VISIBLE: 'true' }).pricingVisible).toBe(true);
    expect(whatsLive({ LANDING_PRICING_VISIBLE: 'yes' }).pricingVisible).toBe(false);
  });

  it('takes legal and support links that are pages here or HTTPS addresses, and email for support', () => {
    expect(
      whatsLive({
        PRIVACY_URL: '/privacy',
        TERMS_URL: 'https://splitbook.example.test/terms',
        SUPPORT_URL: 'mailto:support@splitbook.example.test',
      }).links,
    ).toEqual({
      privacy: '/privacy',
      terms: 'https://splitbook.example.test/terms',
      support: 'mailto:support@splitbook.example.test',
    });
    expect(
      whatsLive({
        PRIVACY_URL: 'http://splitbook.example.test/privacy',
        TERMS_URL: 'mailto:terms@splitbook.example.test',
        SUPPORT_URL: '//elsewhere.example.test/help',
      }).links,
    ).toEqual({ privacy: null, terms: null, support: null });
  });
});
