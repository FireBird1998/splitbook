import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { darkTokens, lightTokens } from '@/lib/theme/tokens';
import { anchors, text } from '@/lib/test-utils/markup';
import GroupForbidden from './forbidden';

/*
 * A Group's server page refused with a 403 (the statement, #319), rendered as the server renders
 * it: the Group page's own words for a Group the member can't open (#201), as the page's one
 * heading, and the way back Home, in the theme's own colours. It takes no props, so the same
 * refusal answers a Group that doesn't exist and one the member may not open.
 */

function render(mode: 'light' | 'dark') {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: createAppTheme(mode) }, createElement(GroupForbidden)),
  );
}

describe('the refusal for a Group the member can’t open', () => {
  it('says so in the Group page’s words, as the page’s heading, with the way back Home', () => {
    const html = render('light');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]).toBe('Group not found');
    expect(text(html)).toBe(
      "Group not found This group may have been deleted or you don't have access. Back to Home",
    );
    expect(anchors(html)).toEqual([{ href: '/dashboard', current: null, text: 'Back to Home' }]);
    // A page to read, not an error to announce, and never the bare word "Forbidden".
    expect(html).not.toContain('role="alert"');
    expect(text(html)).not.toMatch(/forbidden/i);
  });

  it('never names a Group or says whether it exists', () => {
    expect(GroupForbidden.length).toBe(0);
    expect(render('light')).not.toMatch(/[a-f\d]{24}/i);
  });

  it('uses the theme’s text colours in light and in dark', () => {
    for (const [mode, tokens] of [
      ['light', lightTokens],
      ['dark', darkTokens],
    ] as const) {
      const html = render(mode).toLowerCase();
      expect(text(html)).toContain('group not found');
      expect(html).toContain(`color:${tokens.text}`);
      expect(html).toContain(`color:${tokens.textSecondary}`);
    }
  });
});
