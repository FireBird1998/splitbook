import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import type { ThemeMode } from '@/lib/theme/tokens';
import { brandImages, links } from '@/lib/test-utils/markup';
import BrandLogo, { brandLogoWidth } from './BrandLogo';
import BrandMark from './BrandMark';

/*
 * The brand kit in the web app (docs/design/brand/README.md): the real logo and mark artwork,
 * the light or dark variant from the MUI theme, and the alt text the brand standard asks for.
 */

function render(mode: ThemeMode, element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { theme: createAppTheme(mode) }, element),
  );
}

/** The one image a brand component renders. */
function image(html: string) {
  const images = brandImages(html);
  expect(images).toHaveLength(1);
  return images[0];
}

describe('the Splitbook logo', () => {
  it('shows the light artwork on a light theme and the dark artwork on a dark one', () => {
    expect(image(render('light', createElement(BrandLogo))).src).toBe('/brand/logo-light.svg');
    expect(image(render('dark', createElement(BrandLogo))).src).toBe('/brand/logo-dark.svg');
  });

  it('is named Splitbook on its own, and is a link named Splitbook home when it leads home', () => {
    for (const mode of ['light', 'dark'] as const) {
      const plain = render(mode, createElement(BrandLogo));
      expect(image(plain).alt).toBe('Splitbook');
      expect(links(plain)).toEqual([]);

      const home = render(mode, createElement(BrandLogo, { href: '/' }));
      expect(links(home)).toEqual(['/']);
      expect(image(home).alt).toBe('Splitbook home');
    }
  });

  it('keeps the artwork’s 497 × 128 ratio at each standard height, so it never stretches', () => {
    expect(([24, 32, 40] as const).map(brandLogoWidth)).toEqual([93.19, 124.25, 155.31]);
    for (const height of [24, 32, 40] as const) {
      expect(image(render('light', createElement(BrandLogo, { height }))).style).toMatchObject({
        width: `${brandLogoWidth(height)}px`,
        height: `${height}px`,
        'object-fit': 'contain',
        'flex-shrink': '0',
      });
    }
  });

  it('defaults to the 32 px header height', () => {
    expect(image(render('light', createElement(BrandLogo))).style.height).toBe('32px');
  });
});

describe('the Splitbook mark', () => {
  it('shows the indigo artwork on a light theme and the on-dark artwork on a dark one', () => {
    expect(image(render('light', createElement(BrandMark))).src).toBe('/brand/mark-indigo.svg');
    expect(image(render('dark', createElement(BrandMark))).src).toBe('/brand/mark-on-dark.svg');
  });

  it('is decorative beside the visible name, and named Splitbook when it stands alone', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(image(render(mode, createElement(BrandMark))).alt).toBe('');
      expect(image(render(mode, createElement(BrandMark, { decorative: false }))).alt).toBe(
        'Splitbook',
      );
    }
  });

  it('is square at its size and never smaller than 16 px', () => {
    expect(image(render('light', createElement(BrandMark, { size: 48 }))).style).toMatchObject({
      width: '48px',
      height: '48px',
      'object-fit': 'contain',
    });
    expect(image(render('light', createElement(BrandMark, { size: 10 }))).style).toMatchObject({
      width: '16px',
      height: '16px',
    });
  });
});
