import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Alert, Button, Link, Paper, Tabs, Tab, ThemeProvider } from '@mui/material';
import { createTheme, getContrastRatio, getLuminance, hexToRgb } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from './createAppTheme';
import ErrorState from '@/components/common/ErrorState';

/** A `#rrggbb` colour's hue, in degrees. */
function hue(color: string): number {
  const [r, g, b] = hexToRgb(color)
    .match(/\d+/g)!
    .map((channel) => Number(channel) / 255);
  const max = Math.max(r, g, b);
  const range = max - Math.min(r, g, b);
  if (range === 0) return 0;
  const sector =
    max === r ? (g - b) / range : max === g ? (b - r) / range + 2 : (r - g) / range + 4;
  return (sector * 60 + 360) % 360;
}

describe.each(['light', 'dark'] as const)('%s visual theme', (mode) => {
  it('lets a bordered text field’s own border show its focus, with no second ring; a button keeps the ring (#823)', () => {
    const theme = createAppTheme(mode);
    const baseline = theme.components?.MuiCssBaseline?.styleOverrides;
    const rules = (typeof baseline === 'function' ? baseline(theme) : baseline) as Record<
      string,
      Record<string, unknown>
    >;
    // Every element focused from the keyboard gets the ring, a button among them.
    expect(rules[':focus-visible']).toMatchObject({ boxShadow: expect.stringContaining('4px') });
    // An outlined or filled field's focused border is its indicator.
    for (const field of ['.MuiOutlinedInput-input', '.MuiFilledInput-input'])
      expect(rules[`${field}:focus-visible`], field).toEqual({ boxShadow: 'none' });
    expect(Object.keys(rules).filter((selector) => /button/i.test(selector))).toEqual([]);
  });

  it('rings an errored field whole when focused, as its red border can’t change colour; a field without an error has no ring (#823)', () => {
    const theme = createAppTheme(mode);
    const baseline = theme.components?.MuiCssBaseline?.styleOverrides;
    const rules = (typeof baseline === 'function' ? baseline(theme) : baseline) as Record<
      string,
      Record<string, unknown>
    >;
    // The same ring everything else focused from the keyboard has.
    const ring = rules[':focus-visible']!.boxShadow;
    for (const root of ['.MuiOutlinedInput-root', '.MuiFilledInput-root'])
      expect(rules[`${root}.Mui-error.Mui-focused`], root).toEqual({ boxShadow: ring });
    const focusedWithoutError = Object.entries(rules).filter(
      ([selector, rule]) =>
        selector.includes('Mui-focused') && !selector.includes('Mui-error') && 'boxShadow' in rule,
    );
    expect(focusedWithoutError).toEqual([]);
  });

  it('keeps small status text readable on its tint and ordinary surfaces', () => {
    const theme = createAppTheme(mode);
    for (const tone of ['positive', 'negative', 'warning', 'info'] as const) {
      const foreground = theme.palette.status[tone];
      for (const background of [
        theme.palette.tint[tone],
        theme.palette.background.paper,
        theme.palette.background.default,
      ]) {
        expect(
          getContrastRatio(foreground, background),
          `${tone} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps a banner’s text readable on each status tint (#772)', () => {
    const { palette } = createAppTheme(mode);
    for (const tone of ['positive', 'negative', 'warning', 'info'] as const)
      expect(
        getContrastRatio(palette.text.primary, palette.tint[tone]),
        `text on the ${tone} tint`,
      ).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the shell sidebar readable on its hover and current fills', () => {
    const { palette } = createAppTheme(mode);
    const pairs = {
      'link on the sidebar': [palette.text.secondary, palette.surface.elevated],
      'hovered link': [palette.text.primary, palette.surface.hover],
      'current link': [palette.primary.main, palette.tint.brand],
      'current Group, you owe': [palette.status.negative, palette.tint.brand],
      'current Group, owed': [palette.status.positive, palette.tint.brand],
      'current Group, settled': [palette.text.secondary, palette.tint.brand],
      'hovered Group, you owe': [palette.status.negative, palette.surface.hover],
      'hovered Group, owed': [palette.status.positive, palette.surface.hover],
    };
    for (const [pair, [foreground, background]] of Object.entries(pairs))
      expect(getContrastRatio(foreground, background), pair).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps chart text readable and the series colour visible', () => {
    const { palette } = createAppTheme(mode);
    const text = {
      'tooltip text on the inverse surface': [palette.inverse.text, palette.inverse.bg],
      'y-axis labels on a card': [palette.text.disabled, palette.background.paper],
      'x-axis labels on a card': [palette.text.secondary, palette.background.paper],
    };
    for (const [pair, [foreground, background]] of Object.entries(text))
      expect(getContrastRatio(foreground, background), pair).toBeGreaterThanOrEqual(4.5);
    // A graphic, not text: WCAG 1.4.11 asks 3:1 against what is next to it.
    expect(getContrastRatio(palette.chart.series, palette.background.paper)).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('keeps the soft series visible on a card, softer than the series, in the same hue (#308)', () => {
    const { palette } = createAppTheme(mode);
    const { series, seriesSoft } = palette.chart;
    // The columns that aren't in focus are graphics too: 3:1 on a card and on the sidebar.
    for (const surface of [palette.background.paper, palette.surface.elevated])
      expect(getContrastRatio(seriesSoft, surface), surface).toBeGreaterThanOrEqual(3);
    // Still plainly not the series colour: the current Month stands out.
    expect(getContrastRatio(series, seriesSoft)).toBeGreaterThanOrEqual(1.5);
    const towardCard = (color: string) =>
      Math.abs(getLuminance(color) - getLuminance(palette.background.paper));
    expect(towardCard(seriesSoft)).toBeLessThan(towardCard(series));
    // One hue: a lighter or darker series colour, never a second colour.
    expect(Math.abs(hue(seriesSoft) - hue(series))).toBeLessThanOrEqual(2);
  });

  it('styles every chart from the theme: grid, axes and tooltip', () => {
    const theme = createAppTheme(mode);
    const { components, palette } = theme;
    const resolve = (style: unknown) => (typeof style === 'function' ? style({ theme }) : style);
    expect(resolve(components?.MuiChartsGrid?.styleOverrides?.line)).toMatchObject({
      stroke: palette.chart.grid,
    });
    expect(resolve(components?.MuiChartsTooltip?.styleOverrides?.paper)).toMatchObject({
      backgroundColor: palette.inverse.bg,
      color: palette.inverse.text,
    });
  });

  it('draws owed and owes bars that stay visible on a card, in the status hues (#313)', () => {
    const { palette } = createAppTheme(mode);
    const { positive, negative } = palette.diverging;
    // Bars are graphics, not text: WCAG 1.4.11 asks 3:1 against the card they sit on.
    for (const [bar, color] of Object.entries({ positive, negative }))
      expect(getContrastRatio(color, palette.background.paper), bar).toBeGreaterThanOrEqual(3);
    // The same meaning as everywhere else: owed is the positive hue, owes the negative one.
    expect(positive).toBe(palette.success.main);
    expect(negative).toBe(palette.error.main);
    expect(positive).not.toBe(negative);
  });
});

it('server-rendered Paper and tabs use scheme variables before preference adoption', () => {
  const theme = createTheme({
    ...createAppTheme('light'),
    cssVariables: { colorSchemeSelector: '[data-theme="%s"]' },
    colorSchemes: {
      light: { palette: createAppTheme('light').palette },
      dark: { palette: createAppTheme('dark').palette },
    },
  });
  const html = renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme },
      createElement(
        Paper,
        { variant: 'outlined' },
        createElement(Tabs, { value: 0 }, createElement(Tab, { label: 'Expenses' })),
      ),
    ),
  );
  expect(html).toContain('border-color:var(--mui-palette-divider)');
  expect(html).toContain('background-color:var(--mui-palette-surface-muted)');
  expect(html).toContain('color:var(--mui-palette-text-primary)');
});

/** The app's theme with both colour schemes, as the root layout serves it. */
const schemeTheme = () =>
  createTheme({
    ...createAppTheme('light'),
    cssVariables: { colorSchemeSelector: '[data-theme="%s"]' },
    colorSchemes: {
      light: { palette: createAppTheme('light').palette },
      dark: { palette: createAppTheme('dark').palette },
    },
  });

// #772: in dark mode MUI's own standard Alert tint is nearly black, so a banner looked like a hole
// in its card. Each severity takes the palette's status tint, as the canvas's banner does: its
// text in the primary colour, its icon in the status colour.
it.each([
  ['info', 'info'],
  ['warning', 'warning'],
  ['error', 'negative'],
  ['success', 'positive'],
] as const)('a standard %s banner takes the %s tint in either scheme', (severity, tone) => {
  const html = renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: schemeTheme() },
      createElement(Alert, { severity }, 'Prepared items'),
    ),
  );
  // The banner's root rule, Paper's and MUI's own styles first: the last of each wins.
  const root = html.match(/\.css-[\w-]+\{([^}]*)\}/)![1];
  const last = (property: string) =>
    [...root.matchAll(new RegExp(`(?:^|;)${property}:([^;]+)`, 'g'))].at(-1)?.[1];
  expect(last('background-color')).toBe(`var(--mui-palette-tint-${tone})`);
  expect(last('color')).toBe('var(--mui-palette-text-primary)');
  expect(html).toContain(`color:var(--mui-palette-status-${tone})`);
});

// #782: a banner's text buttons and links take its status colour, as the canvas draws banner
// actions: brand blue on the dark info or success tint was just under 4.5:1, and each status
// colour passes on its own tint (above).
it.each([
  ['info', 'info'],
  ['warning', 'warning'],
  ['error', 'negative'],
  ['success', 'positive'],
] as const)(
  'a standard %s banner’s text buttons and links take the %s colour',
  (severity, tone) => {
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: schemeTheme() },
        createElement(
          Alert,
          { severity, action: createElement(Button, { size: 'small' }, 'Undo') },
          'Payment recorded. ',
          createElement(Link, { href: '#activity' }, 'See Activity'),
        ),
      ),
    );
    const rules = [...html.matchAll(/([^{}<>]+)\{([^}]*)\}/g)];
    for (const action of ['MuiButton-text', 'MuiLink-root'])
      expect(
        rules.some(
          ([, selector, body]) =>
            selector.includes(`.${action}`) &&
            body.includes(`color:var(--mui-palette-status-${tone})`),
        ),
        action,
      ).toBe(true);
  },
);

// #782: the error state follows every other banner: its message in the primary colour, its icon
// and Retry in the status colour.
it.each([
  ['error', 'negative'],
  ['warning', 'warning'],
] as const)('the %s state’s message is primary, its icon and Retry %s', (severity, tone) => {
  const html = renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: schemeTheme() },
      createElement(ErrorState, { message: 'Not loaded.', severity, onRetry: () => undefined }),
    ),
  );
  // The banner's root rule: the last colour declared wins.
  const [, rootClass, root] = html.match(/(\.css-[\w-]+)\{([^}]*)\}/)!;
  const colours = [...root.matchAll(/(?:^|;)color:([^;]+)/g)].map((found) => found[1]);
  expect(colours.at(-1)).toBe('var(--mui-palette-text-primary)');
  // No rule on the root with more classes outranks it.
  const outranking = [...html.matchAll(/([^{}<>]+)\{([^}]*)\}/g)].filter(
    ([, selector, body]) =>
      selector.startsWith(`${rootClass}.`) && !/\s/.test(selector) && /(?:^|;)color:/.test(body),
  );
  expect(outranking).toEqual([]);
  const rules = [...html.matchAll(/([^{}<>]+)\{([^}]*)\}/g)];
  // Nor does a rule reach into the message: it keeps the root's primary colour.
  const message = rules.filter(
    ([, selector, body]) => selector.includes('.MuiAlert-message') && /(?:^|;)color:/.test(body),
  );
  expect(message).toEqual([]);
  for (const part of ['MuiAlert-icon', 'MuiButton-text'])
    expect(
      rules.some(
        ([, selector, body]) =>
          selector.includes(`.${part}`) && body.includes(`color:var(--mui-palette-status-${tone})`),
      ),
      part,
    ).toBe(true);
});
