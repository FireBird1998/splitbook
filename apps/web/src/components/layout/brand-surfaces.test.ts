import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import type { ThemeMode } from '@/lib/theme/tokens';
import { brandImages, links, text } from '@/lib/test-utils/markup';

/*
 * Where the brand kit shows in the web app (the "Brand in the product" design): the logo in the
 * shell's sidebar and top bar, sign in, the invite page and the landing page, and the mark where a name sits beside
 * it or a page is loading. Each surface keeps its own words. The invite page's loaded card is
 * checked in the browser (playwright/theme-a11y.spec.ts), since it renders after a request.
 */

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => search.params,
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
  redirect: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({
  GOOGLE_SIGN_IN_FAILED: 'google_sign_in_failed',
  signInWithGoogle: vi.fn(),
  signOutToHome: vi.fn(),
  authClient: { useSession: () => ({ data: null }), demoPersona: { signIn: vi.fn() } },
}));
vi.mock('@/lib/utils/api-response', () => ({ getAuthUser: vi.fn(async () => null) }));

const { default: Sidebar } = await import('./Sidebar');
const { default: TopBar } = await import('./TopBar');
const { default: LoginForm } = await import('@/components/auth/LoginForm');
const { default: LoginPage } = await import('@/app/(auth)/login/page');
const { default: DemoPersonaPicker } = await import('@/components/demo/DemoPersonaPicker');
const { default: LandingPage } = await import('@/components/landing/LandingPage');
const { whatsLive } = await import('@/lib/landing/whats-live');
const { default: JoinGroupClient } = await import('@/components/join/JoinGroupClient');

afterEach(() => {
  search.params = new URLSearchParams();
});

const MODES = ['light', 'dark'] as const;
const logos = (alt: string, height: string) =>
  MODES.map((mode) => ({
    src: `/brand/logo-${mode}.svg`,
    alt,
    height,
  }));
const marks = (alt: string, height: string) => [
  { src: '/brand/mark-indigo.svg', alt, height },
  { src: '/brand/mark-on-dark.svg', alt, height },
];

function render(mode: ThemeMode, element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: createAppTheme(mode) }, element),
  );
}

/** Both variants are server-rendered; CSS chooses the visible one before hydration. */
function brand(html: string) {
  return brandImages(html).map(({ src, alt, style }) => ({ src, alt, height: style.height }));
}

describe('the shell', () => {
  it('leads the sidebar with the 32 px logo as the link Home, named Splitbook home, in place of the typed name', () => {
    for (const mode of MODES) {
      const html = render(
        mode,
        createElement(Sidebar, {
          user: { id: 'a00000000000000000000001', name: 'Alex Rivera', email: 'alex@example.test' },
          pathname: '/dashboard',
          onSignOut: () => {},
        }),
      );
      expect(brand(html)).toEqual([...logos('Splitbook home', '32px')]);
      expect(links(html)[0]).toBe('/dashboard');
      expect(text(html)).not.toContain('Splitbook');
    }
  });

  it('shows the same logo in the top bar, where phones see it, and the mark on the narrowest', () => {
    for (const mode of MODES) {
      const html = render(
        mode,
        createElement(TopBar, {
          userId: 'a00000000000000000000001',
          demoMode: false,
          menuOpen: false,
          onOpenMenu: vi.fn(),
        }),
      );
      // Below 360 px CSS shows the 32 px mark in the logo's place (phone-top-bar.ts): a
      // decorative image in a link that carries the name.
      expect(brand(html)).toEqual([...logos('Splitbook home', '32px'), ...marks('', '32px')]);
      expect(links(html)).toEqual(['/dashboard', '/dashboard']);
      expect(html).toMatch(
        /<a\b(?=[^>]*href="\/dashboard")(?=[^>]*aria-label="Splitbook home")[^>]*>/,
      );
    }
  });
});

describe('sign in', () => {
  it.each(['', 'email_not_allowed', 'google_sign_in_failed', 'unknown'])(
    'Sign in has exactly one Welcome back h1 with error %s',
    (error) => {
      search.params = new URLSearchParams({ error });
      for (const mode of MODES) {
        const html = render(mode, createElement(LoginForm));
        expect(html.match(/<h1\b/g)).toHaveLength(1);
        expect(html).toMatch(/<h1\b[^>]*>Welcome back!<\/h1>/);
        expect(text(html)).not.toContain('...');
      }
    },
  );

  it('shows the 40 px logo, named Splitbook, above Welcome back', () => {
    for (const mode of MODES) {
      const html = render(mode, createElement(LoginForm));
      expect(brand(html)).toEqual([...logos('Splitbook', '40px')]);
      expect(links(html)).toEqual([]);
      expect(text(html)).toMatch(/^Welcome back! Sign in to continue\. Sign in with Google/);
    }
  });

  it('keeps the invite-only message', () => {
    search.params = new URLSearchParams({ error: 'email_not_allowed' });
    expect(text(render('light', createElement(LoginForm)))).toContain(
      'Splitbook is invite-only right now. Ask the owner to add your Google email to the beta.',
    );
  });

  it('keeps one Welcome back h1 and Loading… while Sign in loads', async () => {
    const page = (await LoginPage()) as ReactElement<{ fallback: ReactElement }>;
    for (const mode of MODES) {
      const html = render(mode, page.props.fallback);
      expect(brand(html)).toEqual([...marks('Splitbook', '48px')]);
      expect(text(html)).toBe('Welcome back! Loading…');
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).toMatch(/<h1\b[^>]*>Welcome back!<\/h1>/);
    }
  });

  it('shows the 40 px logo above the demo personas', () => {
    for (const mode of MODES) {
      const html = render(mode, createElement(DemoPersonaPicker));
      expect(brand(html)).toEqual([...logos('Splitbook', '40px')]);
      expect(text(html)).toContain('Enter as a persona');
    }
  });
});

describe('the landing page', () => {
  // Everything off: what a deployment shows before any optional capability is live (#444).
  const live = whatsLive({});

  it('leads with the logo linking home, and closes with the decorative mark beside the name', () => {
    for (const mode of MODES) {
      const html = render(mode, createElement(LandingPage, { live }));
      expect(brand(html)).toEqual([...logos('Splitbook home', '32px'), ...marks('', '24px')]);
      expect(links(html)[0]).toBe('/');
      expect(text(html)).toContain('Splitbook · shared expenses, settled fairly.');
    }
  });

  it('draws its icons with line icons, not emoji', () => {
    const html = render('light', createElement(LandingPage, { live }));
    // ©, ® and ™ are typographic signs, not emoji, though Unicode counts them as pictographs.
    expect(html).not.toMatch(/(?![©®™])\p{Extended_Pictographic}/u);
    const icons = [...html.matchAll(/<svg\b[^>]*data-testid="(\w+)Icon"/g)].map(([, name]) => name);
    expect(icons).toEqual([
      'Google',
      // The content sections (#446): every Theme, the Trip strip's plane, splitting, the web
      // card and its Sign in, and trust.
      'LuggageOutlined',
      'FlightOutlined',
      'HomeOutlined',
      'FavoriteBorderOutlined',
      'WorkOutlineOutlined',
      'PeopleOutlined',
      'CallSplitOutlined',
      'PaymentsOutlined',
      'CheckCircleOutline',
      'CurrencyExchangeOutlined',
      'CheckCircleOutline',
      // Settle up (#449): the arrow in each of the three payments.
      'ArrowForward',
      'ArrowForward',
      'ArrowForward',
      'LaptopOutlined',
      'SearchOutlined',
      'InsertChartOutlined',
      'FileDownloadOutlined',
      'Google',
      'CalculateOutlined',
      'HistoryOutlined',
      'LockOutlined',
      'Google',
    ]);
  });
});

describe('the invite page', () => {
  it('Join has exactly one h1 while its invite loads', () => {
    const html = render(
      'light',
      createElement(JoinGroupClient, {
        code: 'synthetic-invite',
        authMode: 'google',
      }),
    );
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1\b[^>]*>Join Group<\/h1>/);
  });

  it('opens with a header holding the 32 px logo, linking home', () => {
    for (const mode of MODES) {
      const html = render(
        mode,
        createElement(JoinGroupClient, { code: 'synthetic-invite', authMode: 'google' }),
      );
      expect(html).toMatch(
        /^.*?<header\b[^>]*>(?:<style\b[^>]*>[^<]*<\/style>)*<a\b[^>]*href="\/"/,
      );
      expect(brand(html)).toEqual([...logos('Splitbook home', '32px')]);
    }
  });
});
