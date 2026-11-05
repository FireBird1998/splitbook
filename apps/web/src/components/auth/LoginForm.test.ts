import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';

/* Sign in (board WebSignIn): its one h1, and the error banner with its status icon (#646). */

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => search.params }));
vi.mock('@/lib/auth-client', () => ({
  GOOGLE_SIGN_IN_FAILED: 'google_sign_in_failed',
  signInWithGoogle: vi.fn(),
}));

const { default: LoginForm } = await import('./LoginForm');
const { EMAIL_NOT_ALLOWED } = await import('@/lib/auth/allowlist');

afterEach(() => {
  search.params = new URLSearchParams();
});

function render(error: string | null, mode: 'light' | 'dark' = 'light') {
  search.params = new URLSearchParams(error ? { error } : {});
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: createAppTheme(mode) }, createElement(LoginForm)),
  );
}

/** The alert's markup, from its opening tag to the end of the page. */
const alertOf = (html: string) => /<div\b[^>]*role="alert"[\s\S]*$/.exec(html)?.[0] ?? '';

describe('Sign in', () => {
  it.each([
    [
      EMAIL_NOT_ALLOWED,
      'Splitbook is invite-only right now. Ask the owner to add your Google email to the beta.',
    ],
    ['google_sign_in_failed', 'Google sign-in could not start. Please try again.'],
    ['unknown', 'Something went wrong. Please try again.'],
  ])(
    'shows the %s error as the app’s error banner, with its icon and its words',
    (error, words) => {
      for (const mode of ['light', 'dark'] as const) {
        const html = render(error, mode);
        expect(html.match(/<h1\b/g)).toHaveLength(1);
        expect(html).toMatch(/<h1\b[^>]*>Welcome back!<\/h1>/);
        const alert = alertOf(html);
        expect(alert).toContain('MuiAlert-standardError');
        expect(alert).toMatch(
          /class="MuiAlert-icon[^"]*"[^>]*>(?:<style\b[^>]*>[^<]*<\/style>)*<svg\b[^>]*aria-hidden="true"[^>]*data-testid="ErrorOutlineIcon"/,
        );
        expect(text(alert)).toContain(words);
      }
    },
  );

  it('shows no banner without an error', () => {
    expect(render(null)).not.toContain('role="alert"');
  });
});
