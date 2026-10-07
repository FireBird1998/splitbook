import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { simplifyDebtsMinor, type MinorBalance } from '@splitbook/shared/debt-simplifier';
import type { SettlementLedger } from '@splitbook/shared/settlement-preview';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { darkTokens, lightTokens } from '@/lib/theme/tokens';
import { text } from '@/lib/test-utils/markup';
import EveryoneCard, { type EveryoneState, type EveryoneView } from './EveryoneCard';

/*
 * Balances' "Everyone" card (#313), rendered as the server renders it: its loading, error and
 * empty states, the table with who settles with whom, and the diverging bars, which are hidden
 * from assistive technology, coloured from the diverging chart tokens and labelled with their
 * exact amounts. Fictional people and figures: the design canvas's Maple House.
 */

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const people = [
  { id: ALEX, name: 'Alex Rivera' },
  { id: SAM, name: 'Sam Chen' },
  { id: PRIYA, name: 'Priya Shah' },
];

const ledgerOf = (balances: MinorBalance[]): SettlementLedger => ({
  balances,
  suggestions: simplifyDebtsMinor(balances),
});
const maple = ledgerOf([
  { userId: ALEX, amountMinor: -148000 },
  { userId: SAM, amountMinor: 106000 },
  { userId: PRIYA, amountMinor: 42000 },
]);
const ready = (ledger: SettlementLedger): EveryoneState => ({ status: 'ready', ledger });

function render(
  state: EveryoneState,
  { view, mode = 'light' }: { view?: EveryoneView; mode?: 'light' | 'dark' } = {},
) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme(mode) },
      createElement(EveryoneCard, {
        state,
        currency: 'INR',
        viewerId: ALEX,
        people,
        onRetry: () => {},
        initialView: view,
      }),
    ),
  );
}

/** Each table row's cells, as text. */
function tableRows(html: string): string[][] {
  const table = /<table\b[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell]) => text(cell)),
  );
}

/** The CSS rules for an element's classes, as emitted into the static markup. */
function stylesOf(html: string, element: RegExp): string {
  const classes = /class="([^"]*)"/.exec(element.exec(html)?.[0] ?? '')?.[1].split(' ') ?? [];
  return classes
    .map((name) => new RegExp(`\\.${name}\\{([^}]*)\\}`).exec(html)?.[1] ?? '')
    .join(';')
    .toLowerCase();
}

describe('the Everyone card’s states', () => {
  it('announces that it is loading, with no figures and no switch', () => {
    const html = render({ status: 'loading' });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading everyone’s positions"');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('aria-pressed');
    expect(text(html)).toContain('Everyone All-time net · INR');
  });

  it('explains a failed read safely and offers Retry', () => {
    const html = render({ status: 'error' });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('Everyone’s positions could not be loaded.');
    expect(text(html)).toContain('Retry');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('aria-pressed');
  });

  it('says everyone is settled up, which is neither an error nor loading', () => {
    const settled = ledgerOf([
      { userId: ALEX, amountMinor: 0 },
      { userId: SAM, amountMinor: 0 },
    ]);
    const html = render(ready(settled));
    expect(text(html)).toContain(
      'Everyone is settled up in INR. Positions show here when someone owes.',
    );
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('data-testid="everyone-chart"');
    expect(html).not.toContain('aria-pressed');
  });

  it('is an error, not a wrong chart, when the figures don’t add up', () => {
    const html = render(ready({ balances: [{ userId: ALEX, amountMinor: 0.5 }], suggestions: [] }));
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('data-testid="everyone-chart"');
  });
});

describe('the table', () => {
  it('lists each position and who settles with whom, owed first', () => {
    const rows = tableRows(render(ready(maple), { view: 'table' }));
    expect(rows).toEqual([
      ['Member', 'All-time net', 'Position', 'Settled by'],
      ['SC Sam Chen', '+₹1,060.00', 'Gets back', 'Gets ₹1,060.00 from you'],
      ['PS Priya Shah', '+₹420.00', 'Gets back', 'Gets ₹420.00 from you'],
      ['AR You', '−₹1,480.00', 'Owes', 'Pays Sam ₹1,060.00 and Priya ₹420.00'],
    ]);
  });

  it('shows a member with no position as settled up, settled by nobody', () => {
    const rows = tableRows(
      render(
        ready(
          ledgerOf([
            { userId: ALEX, amountMinor: -2500 },
            { userId: SAM, amountMinor: 2500 },
          ]),
        ),
        { view: 'table' },
      ),
    );
    expect(rows[2]).toEqual(['PS Priya Shah', '₹0.00', 'Settled up', '— Nobody']);
  });

  it('has a caption, row headers and column headers for assistive technology', () => {
    const html = render(ready(maple), { view: 'table' });
    expect(text(html)).toContain('Everyone’s all-time net in INR, and who settles with whom');
    expect(html.match(/scope="col"/g)).toHaveLength(4);
    expect(html.match(/scope="row"/g)).toHaveLength(3);
    // It scrolls sideways inside the card on a phone, and takes focus so the keyboard can.
    expect(html).toMatch(/role="region" aria-label="Everyone table" tabindex="0"/);
  });

  it('colours each net with its status colour, beside its sign and its word', () => {
    const html = render(ready(maple), { view: 'table' });
    expect(stylesOf(html, /<td[^>]*>\+₹1,060\.00<\/td>/)).toContain(lightTokens.status.positive);
    expect(stylesOf(html, /<td[^>]*>−₹1,480\.00<\/td>/)).toContain(lightTokens.status.negative);
  });

  it('marks the chosen view as pressed', () => {
    expect(render(ready(maple), { view: 'table' })).toMatch(/aria-pressed="true"[^>]*>Table</);
    expect(render(ready(maple))).toMatch(/aria-pressed="true"[^>]*>Chart</);
  });
});

describe('the chart view', () => {
  it('hides the bars from assistive technology and gives it the same table', () => {
    const html = render(ready(maple));
    expect(html).toMatch(/<div[^>]*aria-hidden="true" data-testid="everyone-chart"/);
    expect(tableRows(html).slice(1)).toEqual([
      ['SC Sam Chen', '+₹1,060.00', 'Gets back', 'Gets ₹1,060.00 from you'],
      ['PS Priya Shah', '+₹420.00', 'Gets back', 'Gets ₹420.00 from you'],
      ['AR You', '−₹1,480.00', 'Owes', 'Pays Sam ₹1,060.00 and Priya ₹420.00'],
    ]);
    expect(html).not.toContain('aria-label="Everyone table"');
  });

  it('draws a bar each side of zero for each position, and none for a settled one', () => {
    const html = render(
      ready(
        ledgerOf([
          { userId: ALEX, amountMinor: -2500 },
          { userId: SAM, amountMinor: 2500 },
        ]),
      ),
    );
    expect(html.match(/data-testid="everyone-row"/g)).toHaveLength(3);
    expect([...html.matchAll(/data-standing="(\w+)"/g)].map(([, standing]) => standing)).toEqual([
      'owed',
      'owes',
    ]);
  });

  it('labels each bar with its exact amount and position, so colour is never the only cue', () => {
    const html = render(ready(maple));
    const labels = [...html.matchAll(/data-testid="everyone-amount"[^>]*>([\s\S]*?)<\/div>/g)].map(
      ([, label]) => text(label),
    );
    expect(labels).toEqual(['+₹1,060.00 gets back', '+₹420.00 gets back', '−₹1,480.00 owes']);
    // A legend names the two colours, and the axis has its scale.
    const chart = /data-testid="everyone-chart">([\s\S]*)$/.exec(html)![1];
    expect(text(chart)).toMatch(/^Owes Gets back /);
    expect(text(/data-testid="everyone-scale"[^>]*>[\s\S]*?<\/div>/.exec(html)![0])).toContain(
      '−₹1.5K 0 +₹1.5K',
    );
  });

  it('labels a settled member’s row Settled up', () => {
    const html = render(
      ready(
        ledgerOf([
          { userId: ALEX, amountMinor: -2500 },
          { userId: SAM, amountMinor: 2500 },
        ]),
      ),
    );
    const labels = [...html.matchAll(/data-testid="everyone-amount"[^>]*>([\s\S]*?)<\/div>/g)].map(
      ([, label]) => text(label),
    );
    expect(labels[1]).toBe('Settled up');
  });

  for (const [mode, tokens] of [
    ['light', lightTokens],
    ['dark', darkTokens],
  ] as const)
    it(`colours owed bars and owes bars from the diverging chart tokens in ${mode}`, () => {
      const html = render(ready(maple), { mode });
      const owed = stylesOf(html, /<div[^>]*data-standing="owed"[^>]*>/);
      const owes = stylesOf(html, /<div[^>]*data-standing="owes"[^>]*>/);
      expect(owed).toContain(`background-color:${tokens.diverging.positive}`);
      expect(owes).toContain(`background-color:${tokens.diverging.negative}`);
      // Owed grows right from the zero line, owes left.
      expect(owed).toContain('left:50%');
      expect(owes).toContain('right:50%');
    });

  it('sizes the bars against one scale, the largest close to its end', () => {
    const html = render(ready(maple));
    const widths = [...html.matchAll(/<div[^>]*data-standing="\w+"[^>]*>/g)].map(
      ([element]) => /width:([\d.]+)%/.exec(stylesOf(html, new RegExp(escape(element))))?.[1],
    );
    expect(widths).toEqual(['35.33', '14', '49.33']);
  });
});

/** A literal string as a regular expression. */
function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
