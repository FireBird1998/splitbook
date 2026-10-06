import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import type { ThemeMode } from '@/lib/theme/tokens';
import { brandImages, links, text } from '@/lib/test-utils/markup';

/*
 * Where the brand kit shows in the web app (the "Brand in the product" design): the logo in the
 * navbar, sign in, the invite page and the landing page, and the mark where a name sits beside
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

const { default: Navbar } = await import('./Navbar');
const { default: LoginForm } = await import('@/components/auth/LoginForm');
const { default: LoginPage } = await import('@/app/(auth)/login/page');
const { default: DemoPersonaPicker } = await import('@/components/demo/DemoPersonaPicker');
const { default: LandingPage } = await import('@/components/landing/LandingPage');
const { default: JoinGroupClient } = await import('@/components/join/JoinGroupClient');

afterEach(() => {
  search.params = new URLSearchParams();
});

const MODES = ['light', 'dark'] as const;
const logo = (mode: ThemeMode) => `/brand/logo-${mode}.svg`;
const mark = (mode: ThemeMode) =>
  mode === 'dark' ? '/brand/mark-on-dark.svg' : '/brand/mark-indigo.svg';

function render(mode: ThemeMode, element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: createAppTheme(mode) }, element),
  );
}

/** Each brand image as a reader meets it: artwork, name and displayed height. */
function brand(html: string) {
  return brandImages(html).map(({ src, alt, style }) => ({ src, alt, height: style.height }));
}

describe('the navbar', () => {
  it('shows the 32 px logo as the link home, named Splitbook home, in place of the typed name', () => {
    for (const mode of MODES) {
      const html = render(
        mode,
        createElement(Navbar, { user: { name: 'Alex Rivera', email: 'alex@example.test' } }),
      );
      expect(brand(html)).toEqual([{ src: logo(mode), alt: 'Splitbook home', height: '32px' }]);
      expect(links(html)[0]).toBe('/dashboard');
      expect(text(html)).not.toContain('Splitbook');
    }
  });
});

describe('sign in', () => {
  it('shows the 40 px logo, named Splitbook, above Welcome back', () => {
    for (const mode of MODES) {
      const html = render(mode, createElement(LoginForm));
      expect(brand(html)).toEqual([{ src: logo(mode), alt: 'Splitbook', height: '40px' }]);
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

  it('shows the 48 px mark, named Splitbook, while the page loads', async () => {
    const page = (await LoginPage()) as ReactElement<{ fallback: ReactElement }>;
    for (const mode of MODES) {
      const html = render(mode, page.props.fallback);
      expect(brand(html)).toEqual([{ src: mark(mode), alt: 'Splitbook', height: '48px' }]);
      expect(text(html)).toBe('Loading...');
    }
  });

  it('shows the 40 px logo above the demo personas', () => {
    for (const mode of MODES) {
      const html = render(mode, createElement(DemoPersonaPicker));
      expect(brand(html)).toEqual([{ src: logo(mode), alt: 'Splitbook', height: '40px' }]);
      expect(text(html)).toContain('Enter as a persona');
    }
  });
});

describe('the landing page', () => {
  it('leads with the logo linking home, and closes with the decorative mark beside the name', () => {
    for (const mode of MODES) {
      const html = render(mode, createElement(LandingPage));
      expect(brand(html)).toEqual([
        { src: logo(mode), alt: 'Splitbook home', height: '32px' },
        { src: mark(mode), alt: '', height: '24px' },
      ]);
      expect(links(html)[0]).toBe('/');
      expect(text(html)).toMatch(/Splitbook — shared expenses, settled fairly\.$/);
    }
  });

  it('draws its features with line icons, not emoji', () => {
    const html = render('light', createElement(LandingPage));
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    const icons = [...html.matchAll(/<svg\b[^>]*data-testid="(\w+)Icon"/g)].map(([, name]) => name);
    expect(icons).toEqual([
      'Google',
      'GroupsOutlined',
      'PieChartOutline',
      'SwapHoriz',
      'DashboardOutlined',
      'HistoryOutlined',
      'TollOutlined',
    ]);
  });
});

describe('the invite page', () => {
  it('opens with a header holding the 32 px logo, linking home', () => {
    for (const mode of MODES) {
      const html = render(
        mode,
        createElement(JoinGroupClient, { code: 'synthetic-invite', authMode: 'google' }),
      );
      expect(html).toMatch(
        /^.*?<header\b[^>]*>(?:<style\b[^>]*>[^<]*<\/style>)*<a\b[^>]*href="\/"/,
      );
      expect(brand(html)).toEqual([{ src: logo(mode), alt: 'Splitbook home', height: '32px' }]);
    }
  });
});
