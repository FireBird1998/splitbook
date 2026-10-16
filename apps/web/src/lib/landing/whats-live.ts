import 'server-only';
import { mcpResource } from '@/lib/mcp/config';

/**
 * What this deployment has live, the one place the landing page learns it (#443, #444). Every
 * section and sentence that describes a capability checks this, and nothing on the page decides
 * on its own that something is live. Everything is off unless its setting turns it on:
 *
 * - Assistants are available when the assistant connection is on and configured
 *   (`MCP_ENABLED`, with an app address it accepts), and can prepare items for To review only
 *   when persistent Drafts are on too (`PERSISTENT_DRAFTS_ENABLED=true`, read exactly as the
 *   assistant connection reads it).
 * - The Google Play listing is `NEXT_PUBLIC_PLAY_STORE_URL`, an `https://play.google.com/store/
 *   apps/details?id=…` address; without one, no store badge or "Get the app" shows.
 * - Pricing shows only with `LANDING_PRICING_VISIBLE=true`, until billing exists.
 * - Privacy, Terms and Support each show only when `PRIVACY_URL`, `TERMS_URL` or `SUPPORT_URL`
 *   names a page here (`/privacy`) or an HTTPS address; Support may also be a `mailto:` address.
 */
export interface WhatsLive {
  assistants: { available: boolean; canPrepare: boolean };
  playStoreUrl: string | null;
  pricingVisible: boolean;
  links: { privacy: string | null; terms: string | null; support: string | null };
}

/** The environment the description is read from: `process.env`, or a stand-in in tests. */
export type WhatsLiveEnv = Readonly<Record<string, string | undefined>>;

const on = (value: string | undefined) => value?.trim() === 'true';

function assistantsAvailable(env: WhatsLiveEnv): boolean {
  try {
    return mcpResource(env) !== null;
  } catch {
    // A connection the server refuses to start is not live.
    return false;
  }
}

function playStoreUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value?.trim() ?? '');
    return url.protocol === 'https:' &&
      url.hostname === 'play.google.com' &&
      url.pathname === '/store/apps/details' &&
      url.searchParams.get('id')
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** A page on this site, or an HTTPS address (or, where allowed, an email address). */
function allowedLink(value: string | undefined, allowEmail = false): string | null {
  const link = value?.trim();
  if (!link) return null;
  if (link.startsWith('/') && !link.startsWith('//')) return link;
  try {
    const url = new URL(link);
    return url.protocol === 'https:' || (allowEmail && url.protocol === 'mailto:') ? link : null;
  } catch {
    return null;
  }
}

export function whatsLive(env: WhatsLiveEnv = process.env): WhatsLive {
  const available = assistantsAvailable(env);
  return {
    assistants: {
      available,
      canPrepare: available && env.PERSISTENT_DRAFTS_ENABLED === 'true',
    },
    playStoreUrl: playStoreUrl(env.NEXT_PUBLIC_PLAY_STORE_URL),
    pricingVisible: on(env.LANDING_PRICING_VISIBLE),
    links: {
      privacy: allowedLink(env.PRIVACY_URL),
      terms: allowedLink(env.TERMS_URL),
      support: allowedLink(env.SUPPORT_URL, true),
    },
  };
}
