import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import type { ThemeMode } from '@/lib/theme/tokens';
import { anchors, brandImages, images, text } from '@/lib/test-utils/markup';
import { whatsLive, type WhatsLive } from '@/lib/landing/whats-live';

/*
 * #444: the landing page's frame (top bar, hero, closing call to action, footer) as a signed-out
 * visitor gets it, rendered to markup, for each "what's live" description and theme.
 */

const session = vi.hoisted(() => ({ user: null as null | { id: string }, demo: false }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect ${to}`);
  }),
}));
vi.mock('@/lib/auth-client', () => ({ signInWithGoogle: vi.fn() }));
vi.mock('@/lib/utils/api-response', () => ({ getAuthUser: vi.fn(async () => session.user) }));
vi.mock('@/lib/auth-mode', () => ({ isDemoMode: () => session.demo }));

const { default: LandingPage, LandingTopBar } = await import('./LandingPage');
const { default: Home, metadata } = await import('@/app/page');
const { default: DemoPersonaPicker } = await import('@/components/demo/DemoPersonaPicker');

afterEach(() => {
  session.user = null;
  session.demo = false;
  vi.unstubAllEnvs();
});

const MODES = ['light', 'dark'] as const;
const PLAY = 'https://play.google.com/store/apps/details?id=com.splitbook.app';
/** What a deployment has live with no optional settings: nothing. */
const OFF = whatsLive({});

function render(mode: ThemeMode, live: WhatsLive): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme(mode) },
      createElement(LandingPage, { live }) as ReactElement,
    ),
  );
}

const linksTo = (html: string, href: string) =>
  anchors(html).filter((anchor) => anchor.href === href);

/** The theme's money font, as the server-rendered style rules name it. */
const MONEY_FONT = String(createAppTheme('light').typography.money.fontFamily).split(',')[0];

/** The text of each element drawn in the money style, in page order. */
function moneyText(html: string): string[] {
  const money = new Set(
    [...html.matchAll(/\.(css-[\w-]+)\{([^}]*)\}/g)]
      .filter(([, , rule]) => rule.includes(`font-family:${MONEY_FONT}`))
      .map(([, name]) => name),
  );
  return [...html.matchAll(/<\w+\b[^>]*\bclass="([^"]*)"[^>]*>([^<]*)(?=<)/g)]
    .filter(([, classes]) => classes.split(' ').some((name) => money.has(name)))
    .map(([, , inner]) => inner.trim());
}

/** The style rules of the element with this id, or of the first element with this tag. */
function rulesOf(html: string, element: RegExp): string {
  const classes = element.exec(html)?.[1]?.split(' ') ?? [];
  return [...html.matchAll(/\.(css-[\w-]+)\{([^}]*)\}/g)]
    .filter(([, name]) => classes.includes(name))
    .map(([, , rule]) => rule)
    .join('');
}

describe('the landing page with everything off', () => {
  it('leads with the headline and Sign in with Google, in both themes', () => {
    for (const mode of MODES) {
      const html = render(mode, OFF);
      expect(html).toMatch(/<h1\b[^>]*>Every shared cost, worked out to the paisa\.<\/h1>/);
      expect(text(html)).toContain(
        'Trips, flats, couples and teams. Add what was paid, split it the way it happened, and Splitbook shows who owes whom, then settles it in the fewest payments.',
      );
      // Once in the hero and once in the closing call to action.
      expect(text(html).match(/Sign in with Google/g)).toHaveLength(2);
      expect(text(html)).toContain('Start your first Group tonight. Settle it by the weekend.');
      expect(linksTo(html, '/login').map((anchor) => anchor.text)).toEqual(['Sign in']);
    }
  });

  it('shows the theme’s logo linking home, and the decorative mark in the footer', () => {
    for (const mode of MODES) {
      const html = render(mode, OFF);
      expect(
        brandImages(html).map(({ src, alt, style }) => ({ src, alt, height: style.height })),
      ).toEqual([
        { src: `/brand/logo-${mode}.svg`, alt: 'Splitbook home', height: '32px' },
        {
          src: mode === 'dark' ? '/brand/mark-on-dark.svg' : '/brand/mark-indigo.svg',
          alt: '',
          height: '24px',
        },
      ]);
      expect(anchors(html)[0].href).toBe('/');
      expect(text(html)).toContain('Splitbook · shared expenses, settled fairly.');
    }
  });

  it('offers no store link, assistants link, pricing or legal links', () => {
    for (const mode of MODES) {
      const html = render(mode, OFF);
      expect(anchors(html).map((anchor) => anchor.href)).toEqual(['/', '/login']);
      expect(images(html).map((image) => image.src)).not.toContain(
        '/badges/google-play-badge-en.png',
      );
      expect(text(html)).not.toMatch(
        /Get the app|Google Play|Claude|ChatGPT|Pricing|Plus|₹29|Privacy|Terms|Support|Android/,
      );
    }
  });

  it('uses none of the Glossary’s avoid-words', () => {
    for (const live of [
      OFF,
      {
        assistants: { available: true, canPrepare: true },
        playStoreUrl: PLAY,
        pricingVisible: true,
        links: { privacy: '/privacy', terms: '/terms', support: '/support' },
      },
    ])
      expect(text(render('light', live))).not.toMatch(
        /\b(inbox|drafts?|keep as draft|cache|bot|agent|integration|cycle)\b/i,
      );
  });
});

describe('the landing page with a Google Play listing', () => {
  const live = { ...OFF, playStoreUrl: PLAY };

  it('links Get the app and the official badge to the listing, in both themes', () => {
    for (const mode of MODES) {
      const html = render(mode, live);
      const store = linksTo(html, PLAY);
      // The top bar's Get the app, then the badge in the hero and in the closing call to action.
      expect(store.map((anchor) => anchor.text)).toEqual(['Get the app', '', '']);
      expect(
        images(html)
          .filter((image) => image.src === '/badges/google-play-badge-en.png')
          .map((image) => image.alt),
      ).toEqual(['Get it on Google Play', 'Get it on Google Play']);
      expect(text(html)).toContain('Shared expenses · Android and web');
      expect(text(html)).toContain(
        'Google Play and the Google Play logo are trademarks of Google LLC.',
      );
    }
  });
});

describe('the landing page with assistants available', () => {
  it('links to the assistants section from the hero', () => {
    const html = render('light', { ...OFF, assistants: { available: true, canPrepare: false } });
    expect(linksTo(html, '#assistants').map((anchor) => anchor.text)).toEqual([
      'Use Claude or ChatGPT? Connect Splitbook',
    ]);
  });

  it('links the footer to the guide for connecting ChatGPT', () => {
    const html = render('light', { ...OFF, assistants: { available: true, canPrepare: false } });
    expect(linksTo(html, '/connect/chatgpt').map((anchor) => anchor.text)).toEqual([
      'Assistant guide',
    ]);
  });
});

describe('the top bar', () => {
  it('links to the sections the page shows, between the logo and Sign in', () => {
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(LandingTopBar, {
          live: OFF,
          sections: [
            { href: '#how', label: 'How it works' },
            { href: '#groups', label: 'Groups' },
          ],
        }),
      ),
    );
    expect(anchors(html).map(({ href, text: label }) => [href, label])).toEqual([
      ['/', ''],
      ['#how', 'How it works'],
      ['#groups', 'Groups'],
      ['/login', 'Sign in'],
    ]);
  });
});

describe('the landing page’s pricing (#447)', () => {
  const live = { ...OFF, pricingVisible: true };
  const plans = (html: string) =>
    [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)].map(([, inner]) => text(inner));

  it('shows no pricing section or Pricing link until the setting is on', () => {
    for (const mode of MODES) {
      const html = render(mode, OFF);
      expect(html).not.toContain('id="pricing"');
      expect(linksTo(html, '#pricing')).toEqual([]);
      expect(plans(html)).toEqual([]);
      expect(text(html)).not.toContain('₹');
    }
  });

  it('shows Free and Plus at the launch prices, in the money style, in both themes', () => {
    for (const mode of MODES) {
      const html = render(mode, live);
      expect(html).toMatch(
        /<h2\b[^>]*id="pricing-title"[^>]*>Free for a few Groups\. .*₹29.* a month for more\.<\/h2>/,
      );
      expect(text(html)).toContain('Launch prices. ₹199 a year works out to under ₹17 a month.');
      expect(plans(html)).toEqual([
        'Free ₹0 For a trip or two. Three Groups, made or joined Expenses, splits, Balances and settle up Android and web Light ads, never on save or settle-up screens Start free',
        'Plus Best value yearly ₹29 a month · or ₹199 a year For the flat, the office and every trip. More Groups No ads Web dashboards, Group insights and exports One subscription on Android and web Get Plus',
      ]);
      // Every amount is in the money style: the heading, the launch line, then each plan.
      expect(moneyText(html)).toEqual(['₹29', '₹199', '₹17', '₹0', '₹29', '₹199']);
      expect(linksTo(html, '/login').map((anchor) => anchor.text)).toEqual([
        'Sign in',
        'Start free',
        'Get Plus',
      ]);
    }
  });

  it('draws Plus in the brand colour and the section on the raised surface of each theme', () => {
    for (const mode of MODES) {
      const { palette } = createAppTheme(mode);
      const html = render(mode, live);
      expect(rulesOf(html, /<section\b[^>]*class="([^"]*)"[^>]*id="pricing"/)).toContain(
        `background-color:${palette.surface.elevated}`,
      );
      const [, plus] = [...html.matchAll(/<article\b[^>]*class="([^"]*)"/g)].map(([, classes]) =>
        rulesOf(html, new RegExp(`class="(${classes})"`)),
      );
      expect(plus).toContain(`border-color:${palette.primary.main}`);
    }
  });

  it('adds Pricing to the top bar only with the section', () => {
    const html = render('light', live);
    expect(
      anchors(html)
        .map(({ href, text: label }) => [href, label])
        .slice(0, 3),
    ).toEqual([
      ['/', ''],
      ['#pricing', 'Pricing'],
      ['/login', 'Sign in'],
    ]);
  });
});

describe('the landing page with legal and support pages', () => {
  it('lists only the configured links in the footer', () => {
    const footer = (links: WhatsLive['links']) =>
      anchors(render('light', { ...OFF, links })).filter((anchor) =>
        ['Privacy', 'Terms', 'Support'].includes(anchor.text),
      );
    expect(
      footer({ privacy: '/privacy', terms: null, support: 'mailto:help@example.test' }),
    ).toEqual([
      expect.objectContaining({ href: '/privacy', text: 'Privacy' }),
      expect.objectContaining({ href: 'mailto:help@example.test', text: 'Support' }),
    ]);
  });
});

describe('the home page route', () => {
  it('sends a signed-in member to Home', async () => {
    session.user = { id: 'a00000000000000000000001' };
    await expect(Home()).rejects.toThrow('redirect /dashboard');
  });

  it('shows the persona picker in demo mode', async () => {
    session.demo = true;
    expect(((await Home()) as ReactElement).type).toBe(DemoPersonaPicker);
  });

  it('gives a signed-out visitor the landing page with what this deployment has live', async () => {
    vi.stubEnv('NEXT_PUBLIC_PLAY_STORE_URL', PLAY);
    vi.stubEnv('PRIVACY_URL', '/privacy');
    const page = (await Home()) as ReactElement<{ live: WhatsLive }>;
    expect(page.type).toBe(LandingPage);
    expect(page.props.live.playStoreUrl).toBe(PLAY);
    expect(page.props.live.links.privacy).toBe('/privacy');
    expect(page.props.live.pricingVisible).toBe(false);
  });

  it('describes itself for link previews', () => {
    expect(metadata).toMatchObject({
      title: 'Splitbook · Every shared cost, worked out to the paisa',
      description: expect.stringContaining('split it the way it happened'),
      openGraph: { title: 'Splitbook · Every shared cost, worked out to the paisa' },
    });
  });
});
