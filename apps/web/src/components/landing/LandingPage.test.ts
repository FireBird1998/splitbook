import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import type { ThemeMode } from '@/lib/theme/tokens';
import { anchors, brandImages, images, svgImages, text } from '@/lib/test-utils/markup';
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

/**
 * The text of each element drawn in the money style, in page order; with `from`, only those after
 * it, such as one section's (#446 put other amounts on the page).
 */
function moneyText(html: string, from?: string): string[] {
  const money = new Set(
    [...html.matchAll(/\.(css-[\w-]+)\{([^}]*)\}/g)]
      .filter(([, , rule]) => rule.includes(`font-family:${MONEY_FONT}`))
      .map(([, name]) => name),
  );
  const shown = from === undefined ? html : html.slice(html.indexOf(from));
  return [...shown.matchAll(/<\w+\b[^>]*\bclass="([^"]*)"[^>]*>([^<]*)(?=<)/g)]
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
        'Trips, flats, couples and teams. Add what was paid, split it the way it happened, and Splitbook shows who owes whom, and the fewest payments that settle it.',
      );
      // In the hero, on the web card (#446) and in the closing call to action.
      expect(text(html).match(/Sign in with Google/g)).toHaveLength(3);
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
        { src: '/brand/logo-light.svg', alt: 'Splitbook home', height: '32px' },
        { src: '/brand/logo-dark.svg', alt: 'Splitbook home', height: '32px' },
        { src: '/brand/mark-indigo.svg', alt: '', height: '24px' },
        { src: '/brand/mark-on-dark.svg', alt: '', height: '24px' },
      ]);
      expect(anchors(html)[0].href).toBe('/');
      expect(text(html)).toContain('Splitbook · shared expenses, settled fairly.');
    }
  });

  it('offers no store link, assistants link, pricing or legal links', () => {
    for (const mode of MODES) {
      const html = render(mode, OFF);
      expect(anchors(html).map((anchor) => anchor.href)).toEqual([
        '/',
        '#how',
        '#groups',
        '/login',
      ]);
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
        toReview: true,
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
      // The top bar's Get the app, then the badge in the hero, on the Android card (#446) and in
      // the closing call to action.
      expect(store.map((anchor) => anchor.text)).toEqual(['Get the app', '', '', '']);
      expect(
        images(html)
          .filter((image) => image.src === '/badges/google-play-badge-en.png')
          .map((image) => image.alt),
      ).toEqual(['Get it on Google Play', 'Get it on Google Play', 'Get it on Google Play']);
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
    // The top bar's link to the section (#450), then the hero's.
    expect(linksTo(html, '#assistants').map((anchor) => anchor.text)).toEqual([
      'Assistants',
      'Use Claude or ChatGPT? Connect Splitbook',
    ]);
  });

  it('links the footer to the guide for connecting ChatGPT', () => {
    const html = render('light', { ...OFF, assistants: { available: true, canPrepare: false } });
    // The section's own link to the guide (#450), then the footer's.
    expect(linksTo(html, '/connect/chatgpt').map((anchor) => anchor.text)).toEqual([
      'How to connect ChatGPT',
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
      // No price: the page's other amounts are the content sections' (#446).
      expect(text(html)).not.toMatch(/₹29|₹199|Free for a few Groups/);
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
      expect(moneyText(html, 'id="pricing"')).toEqual(['₹29', '₹199', '₹17', '₹0', '₹29', '₹199']);
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
        .slice(0, 5),
    ).toEqual([
      ['/', ''],
      ['#how', 'How it works'],
      ['#groups', 'Groups'],
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

describe('Fig 1 in the hero', () => {
  it('shows the splitting line in its plate, named by its full description, in both themes', () => {
    for (const mode of MODES) {
      const html = render(mode, OFF);
      expect(svgImages(html)[0]).toEqual(
        expect.stringMatching(
          /^A small production line on a bench that splits Expenses\. .* into the bin of the member it belongs to: You, Priya, Sam and Alex\. Each bin's counter shows that member's balance, and a lamp marks who paid\.$/,
        ),
      );
      expect(text(html)).toContain('Fig 1 The splitting line');
      expect(text(html)).toContain('Line idle · 3 Expenses waiting');
      for (const key of [
        'Bins, left to right: You, Priya, Sam and Alex',
        '+ gets back',
        '− owes',
        'Lamp: who paid',
        'Each Expense is cut into one chip per share, and the counters always add up to zero.',
      ])
        expect(text(html)).toContain(key);
    }
  });

  it('draws the figures in the page’s theme', () => {
    for (const mode of MODES) {
      // With assistants preparing items, Fig 2 is on the page too (#450).
      const html = render(mode, {
        ...OFF,
        assistants: { available: true, canPrepare: true },
        toReview: true,
      });
      // Figures inherit the pre-paint root choice, even while the JS theme is still light.
      expect(html).not.toMatch(/<figure\b[^>]*data-theme=/);
      expect(html).toContain(':root:not([data-theme="dark"]) .iso');
    }
  });
});

describe('the Settle up section', () => {
  it('shows five debts becoming three payments, with Fig 3 and the payments, in both themes', () => {
    for (const mode of MODES) {
      const html = render(mode, OFF);
      expect(html).toMatch(/<h2\b[^>]*>Five debts between four people\. Three payments\.<\/h2>/);
      expect(text(html)).toContain(
        'Splitbook nets every Expense into one balance each, then works out the fewest payments that clear them. When someone pays you back, record it and the whole Group sees it in Activity.',
      );
      expect(svgImages(html)).toContainEqual(
        expect.stringMatching(
          /^A netting station on a bench\. Four tills .*: You \+500, Priya −100, Sam \+300 and Alex −700\. .* five debts left by three Expenses .* three payment cords, .*: five from Alex to You, two from Alex to Sam and one from Priya to Sam\. Then every counter reads zero\.$/,
        ),
      );
      expect(text(html)).toContain('Fig 3 The netting station');
      expect(text(html)).toContain('Grey cords: the debts the Expenses left');
      // The three payments beneath it, as Splitbook's simplify step works them out.
      for (const payment of [
        'Alex pays You ₹500.00',
        'Alex pays Sam ₹200.00',
        'Priya pays Sam ₹100.00',
      ])
        expect(text(html)).toContain(payment);
    }
  });

  it('comes after the split and before Android and web', () => {
    const order = (html: string) =>
      [...html.matchAll(/<section\b[^>]*\sid="(\w+)"/g)].map((m) => m[1]);
    const ids = order(render('light', OFF));
    expect(ids.indexOf('settle')).toBe(ids.indexOf('how') + 1);
  });
});

describe('the Connected assistants section (#450)', () => {
  const READING = { ...OFF, assistants: { available: true, canPrepare: false } };
  const PREPARING = { ...OFF, assistants: { available: true, canPrepare: true }, toReview: true };
  const ids = (html: string) => [...html.matchAll(/<section\b[^>]*\sid="(\w+)"/g)].map((m) => m[1]);
  /** The words of each list item in this markup. */
  const items = (html: string) =>
    [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, item]) => text(item));
  const steps = (html: string) =>
    [...section(html, 'assistants').matchAll(/<ol\b[^>]*>([\s\S]*?)<\/ol>/g)].flatMap(([, list]) =>
      items(list),
    );
  /** The section's words as read, without the space text() leaves before punctuation after a tag. */
  const said = (html: string) => text(html).replace(/\s+([.,:])/g, '$1');
  /** Anything the section says about preparing items, which only a preparing deployment may say. */
  const TO_REVIEW_CLAIM =
    /To review|prepar|Tell it what you spent|You save, never|review and save/i;

  it('is absent, and nothing links to it, while assistants aren’t available', () => {
    for (const mode of MODES) {
      const html = render(mode, OFF);
      expect(ids(html)).not.toContain('assistants');
      expect(linksTo(html, '#assistants')).toEqual([]);
      expect(text(html)).not.toMatch(/Talk to your Groups|Connected assistants|Fig 2/);
      expect(svgImages(html)).not.toContainEqual(expect.stringMatching(/To review rack/));
    }
  });

  it('covers connecting and reading only while assistants can’t prepare items, in both themes', () => {
    for (const mode of MODES) {
      const html = render(mode, READING);
      const own = section(html, 'assistants');
      expect(own).toMatch(/<h2\b[^>]*>Talk to your Groups in Claude or ChatGPT\.<\/h2>/);
      expect(text(own)).toContain(
        'Connect your Splitbook account once and ask what you owe. Nothing is saved until you say so.',
      );
      expect(steps(html)).toEqual([
        '1 Add Splitbook as a connector',
        '2 Sign in and approve',
        '3 Ask about your Groups',
      ]);
      // A chat that asks about money, answered from the Settle up section's own payments.
      expect(said(own)).toContain(
        'You: Who still owes me for Goa? Claude: In Goa Weekend, Alex owes you ₹500.00.',
      );
      expect(moneyStyled(own, '₹500.00')).toEqual([true]);
      expect(headings(own, 3)).toEqual(['Ask about your money', 'Stay in control']);
      expect(text(own)).toContain(
        '“Who still owes me for Goa?” It reads your Groups, their members, Tags, Balances and spending, as you.',
      );
      expect(text(own)).not.toMatch(TO_REVIEW_CLAIM);
      expect(svgImages(own)).toEqual([]);
      expect(linksTo(own, '/connect/chatgpt').map((anchor) => anchor.text)).toEqual([
        'How to connect ChatGPT',
      ]);
    }
  });

  it('adds review and save, a prepared item, its two statements and Fig 2 while assistants can prepare items, in both themes', () => {
    for (const mode of MODES) {
      const html = render(mode, PREPARING);
      const own = section(html, 'assistants');
      expect(text(own)).toContain(
        'Connect your Splitbook account once. Ask what you owe, or say what you spent and let the assistant prepare it for To review. Nothing is saved until you say so.',
      );
      expect(steps(html)).toEqual([
        '1 Add Splitbook as a connector',
        '2 Sign in and approve',
        '3 Ask, or tell it what you spent',
        '4 Review and save',
      ]);
      expect(said(own)).toContain(
        'You: Add dinner at Thalassa, ₹2,400. I paid, split with Priya and Sam. Claude: Added 1 to To review in Goa Weekend: Dinner at Thalassa, ₹2,400.00, paid by you, split equally between 3, Tag Food. Open To review to save it.',
      );
      expect(moneyStyled(own, '₹2,400.00')).toEqual([true]);
      expect(headings(own, 3)).toEqual([
        'Ask about your money',
        'Tell it what you spent',
        'You save, never the assistant',
        'Stay in control',
      ]);
      for (const sentence of [
        'With a separate OK, which starts switched off, it prepares up to 10 items at a time in To review.',
        // #443 story 23: nothing reaches Balances until the member saves it.
        'You check each item and save it yourself: nothing reaches Balances until you do. A saved Expense shows “prepared by Claude” to the Group.',
      ])
        expect(text(own)).toContain(sentence);
      expect(svgImages(own)).toEqual([
        expect.stringMatching(
          /^A To review rack on a bench\. .* stacked one on another: Dinner at Thalassa, ₹2,400 between You, Priya and Sam, and Cab to the airport, ₹600 between You and Priya\. .* The member saves Dinner at Thalassa, and Cab to the airport waits in the rack\. The tube never reaches the conveyor\.$/,
        ),
      ]);
      for (const words of [
        'Fig 2 The To review rack',
        // At rest it shows its still: Dinner saved, Cab waiting.
        'Cab to the airport ₹600 waits in To review · nothing moves until you save it',
        'Your lever: the only way a bar leaves the rack',
        'Bars with a blue tag: items an assistant prepared',
        'The thin read line lets it see Balances; the tube ends at the rack, never at the line',
        'Dinner at Thalassa ₹2,400 between You, Priya and Sam (three ₹800 chips) and Cab to the airport ₹600 between You and Priya (two ₹300 chips).',
      ])
        expect(text(own)).toContain(words);
    }
  });

  it('promises, whatever an assistant can do, that it sees members’ names, never their email addresses (#451)', () => {
    // The assistant tools stopped sending members' email addresses with #438.
    for (const live of [READING, PREPARING])
      for (const mode of MODES) {
        const own = section(render(mode, live), 'assistants');
        expect(items(own).filter((card) => card.startsWith('Stay in control'))).toEqual([
          'Stay in control Disconnect any time in Settings. Assistants see members’ names, never their email addresses.',
        ]);
        // That is the section's only word about email.
        expect(text(own).match(/email/gi)).toHaveLength(1);
      }
  });

  it('comes after Settle up and before Android and web, linked from the top bar', () => {
    for (const live of [READING, PREPARING]) {
      const html = render('light', live);
      const order = ids(html);
      expect(order.indexOf('assistants')).toBe(order.indexOf('settle') + 1);
      expect(order.indexOf('app')).toBe(order.indexOf('assistants') + 1);
      expect(linksTo(html, '#assistants').map((anchor) => anchor.text)).toEqual([
        'Assistants',
        'Use Claude or ChatGPT? Connect Splitbook',
      ]);
    }
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
    // The hero's promise; Splitbook works out the payments, members make them (owner copy).
    const promise =
      'Trips, flats, couples and teams. Add what was paid, split it the way it happened, and Splitbook shows who owes whom, and the fewest payments that settle it.';
    expect(metadata).toMatchObject({
      title: 'Splitbook · Every shared cost, worked out to the paisa',
      description: promise,
      openGraph: {
        title: 'Splitbook · Every shared cost, worked out to the paisa',
        description: promise,
        // The light still of Fig 1, as the tour holds it under reduced motion.
        images: [
          {
            url: '/landing-figures/splitting-line-light.png',
            width: 1200,
            height: 630,
            alt: expect.stringContaining(
              'While Groceries ₹1,000, paid by Sam, is being sorted, the bins for You, Priya, Sam and Alex read +900, +100, −500 and −500.',
            ),
          },
        ],
      },
    });
  });
});

/** The CSS a rendered element's classes get, from the styles the render emits. */
function moneyStyled(html: string, amount: string): boolean[] {
  const rules = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('');
  return [...html.matchAll(/<span class="([^"]*)"[^>]*>([^<]*)<\/span>/g)]
    .filter(([, , content]) => content === amount)
    .map(([, classes]) =>
      classes
        .split(/\s+/)
        .some((name) =>
          new RegExp(`\\.${name}\\{[^}]*font-variant-numeric:tabular-nums`).test(rules),
        ),
    );
}

/** One section's markup, with the styles the render emits, so moneyStyled reads it alone. */
function section(html: string, id: string): string {
  const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]).join('');
  const start = html.lastIndexOf('<section', html.indexOf(` id="${id}"`));
  return styles + html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
}

const headings = (html: string, level: number) =>
  [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, 'g'))].map(
    ([, inner]) => text(inner),
  );

describe('the content sections (#446)', () => {
  it('come in order between the hero and the closing call to action, in both themes', () => {
    for (const mode of MODES)
      expect(headings(render(mode, OFF), 2)).toEqual([
        'Not just trips. Every kind of shared money.',
        'Split it the way it actually happened.',
        'Five debts between four people. Three payments.',
        'Your Groups on a bigger screen.',
        'Why you can trust it',
        'Start your first Group tonight. Settle it by the weekend.',
      ]);
  });

  it('show every Theme with its tagline, the strip once on the Trip card, Trip days and Month totals', () => {
    for (const mode of MODES) {
      const html = render(mode, OFF);
      expect(headings(html, 3).slice(0, 5)).toEqual([
        'Trip',
        'Household',
        'Couple',
        'Work',
        'General',
      ]);
      const shown = text(html);
      for (const sentence of [
        'A getaway with a crew: travel, stays and shared meals, from the first day to the last.',
        'A boarding-pass header, a setup checklist and a date range, with Expenses grouped by Trip day.',
        'A long-running home ledger: rent, groceries and utilities.',
        'Month-by-month totals and a running balance.',
        'Shared spending for two: dinners, gifts and everyday costs.',
        'Team and project expenses: travel, meals and supplies.',
        'Any shared pool of money: Sunday football, a club, a gift fund.',
      ])
        expect(shown).toContain(sentence);
      expect(shown.match(/A clean shared ledger with a running balance\./g)).toHaveLength(3);
      // The boarding-pass strip, once on the page.
      expect(html.match(/aria-label="Goa Weekend[^"]*"/g)).toHaveLength(1);
      for (const day of ['Day 1', 'Day 2', 'Day 3']) expect(shown).toContain(day);
      for (const amount of [
        '₹6,420.00',
        '₹2,800.00',
        '₹3,150.00',
        '₹21,860.00',
        '₹23,540.00',
        '₹17,920.00',
      ])
        expect(moneyStyled(html, amount)).toEqual([true]);
    }
  });

  it('say how an Expense splits, exactly, beside the Groceries card worked out by Splitbook’s split', () => {
    for (const mode of MODES) {
      const html = render(mode, OFF);
      const shown = text(html);
      for (const sentence of [
        'Equally, by shares, by percent or exact amounts, between everyone or just the people who were there.',
        'More than one payer? Say who paid what, and the split still adds up.',
        'Every paisa lands somewhere. ₹1,000 between three is ₹333.34 + ₹333.33 + ₹333.33, never ₹999.99.',
        'Each Group keeps its own currency, and balances never add currencies together.',
      ])
        expect(shown).toContain(sentence);
      // Every Expense and payment is in its Group's currency (#507).
      expect(shown).not.toMatch(/two more|other currenc|multi-?currenc/i);
      expect(shown).toMatch(/Groceries.*Paid by Sam.*Split by shares/);
      // Shares 2:1:1:1 of ₹1,000: You ₹400, and ₹200 each for Priya, Sam and Alex.
      for (const [name, shares] of [
        ['You', '2 shares'],
        ['Priya', '1 share'],
        ['Sam', '1 share'],
        ['Alex', '1 share'],
      ])
        expect(shown).toContain(`${name} ${shares}`);
      const split = section(html, 'how');
      expect(moneyStyled(split, '₹400.00')).toEqual([true]);
      expect(moneyStyled(split, '₹200.00')).toEqual([true, true, true]);
      // The total, and what the shares add up to.
      expect(moneyStyled(split, '₹1,000.00')).toEqual([true, true]);
    }
  });

  it('show the web card everywhere, and the Android card only with a Play listing', () => {
    const off = text(render('light', OFF));
    for (const sentence of [
      'Search every Expense across your Groups.',
      'Charts of spending by Month, with the current Month in focus.',
      'Export to CSV, keep a backup, or print a statement.',
    ])
      expect(off).toContain(sentence);
    expect(off).not.toMatch(/Android|Add an Expense in a few taps/);

    for (const mode of MODES) {
      const html = render(mode, { ...OFF, playStoreUrl: PLAY });
      expect(headings(html, 2)).toContain('One account on your phone and your laptop.');
      const shown = text(html);
      for (const sentence of [
        'Same Groups, same balances. Add on the bus, review at your desk.',
        'Add an Expense in a few taps, wherever you paid.',
        'No signal? Your saved copy of each Group stays readable.',
        'Home shows what you owe and are owed in every currency.',
      ])
        expect(shown).toContain(sentence);
      // Finish later is To review's, said only where To review is live.
      expect(shown).not.toMatch(/Finish later|To review/);
      expect(headings(html, 3)).toEqual(expect.arrayContaining(['Android', 'Web']));
    }
    expect(text(render('light', { ...OFF, playStoreUrl: PLAY, toReview: true }))).toContain(
      'No signal? Your saved copy of each Group stays readable, and Finish later keeps a half-done Expense in To review.',
    );
  });

  it('say why the money can be trusted', () => {
    const shown = text(render('dark', OFF));
    for (const sentence of [
      'Exact money',
      'Amounts are stored as whole paise or cents, never rounded floats, and every split adds up to the Expense.',
      'Every change in Activity',
      'Edits, deletions and payments are logged, so the Group can always see what changed and who changed it.',
      'Private by default',
      'Only the people in a Group see it. You sign in with Google; there is no password to leak.',
    ])
      expect(shown).toContain(sentence);
  });
});
