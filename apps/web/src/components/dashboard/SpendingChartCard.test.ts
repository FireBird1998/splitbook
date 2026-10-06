import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import type { UserSpendingRead } from '@splitbook/shared/user-spending-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import { SpendingChartView, type SpendingView } from './SpendingChartCard';

/*
 * Home's "Your share of spending" card (#307), rendered as the server renders it: its loading,
 * empty and error states, the table that holds the same numbers as the chart, and the chart
 * hidden from assistive technology. Fictional Groups and figures.
 */

const maple = 'b00000000000000000000001';
const goa = 'b00000000000000000000002';
const lisbon = 'b00000000000000000000003';
const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

const READ: UserSpendingRead = {
  timeZone: 'Asia/Kolkata',
  months: MONTHS,
  window: { from: '2026-04-01', to: '2026-09-30' },
  groups: [
    { groupId: goa, name: 'Goa Friends Trip' },
    { groupId: lisbon, name: 'Lisbon Offsite' },
    { groupId: maple, name: 'Maple House' },
  ],
  currencies: [
    {
      currency: 'INR',
      totalMinor: 4174500,
      expenseCount: 40,
      months: MONTHS.map((month, index) => {
        const mapleShare = [566000, 588000, 640333, 601667, 579500, 614000][index];
        const goaShare = index === 5 ? 328000 : 0;
        return {
          month,
          shareMinor: mapleShare + goaShare,
          byGroup: [
            { groupId: maple, shareMinor: mapleShare },
            ...(goaShare ? [{ groupId: goa, shareMinor: goaShare }] : []),
          ],
        };
      }),
    },
    {
      currency: 'EUR',
      totalMinor: 1250,
      expenseCount: 1,
      months: MONTHS.map((month) => ({
        month,
        shareMinor: month === '2026-08' ? 1250 : 0,
        byGroup: month === '2026-08' ? [{ groupId: lisbon, shareMinor: 1250 }] : [],
      })),
    },
  ],
};

function render(props: { read?: UserSpendingRead; failed?: boolean; initialView?: SpendingView }) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(SpendingChartView, {
        read: props.read,
        failed: props.failed ?? false,
        onRetry: () => {},
        initialView: props.initialView,
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

describe('the spending card’s states', () => {
  it('announces that it is loading, with no figures and no switches', () => {
    const html = render({});
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading your spending"');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('aria-pressed');
    expect(text(html)).toContain('Your share of spending');
  });

  it('explains a failed read safely and offers Try again', () => {
    const html = render({ failed: true });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('Your spending could not be loaded.');
    expect(text(html)).toContain('Try again');
    expect(html).not.toContain('<table');
  });

  it('says there is no spending yet, which is neither an error nor loading', () => {
    const html = render({ read: { ...READ, currencies: [] } });
    expect(text(html)).toContain('No spending yet');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('<table');
  });

  it('keeps the figures from a read it already has, even if a refresh fails', () => {
    const html = render({ read: READ, failed: true });
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('<table');
  });
});

describe('the table', () => {
  it('shows a row per Month and a column per Group, then the member’s share', () => {
    const rows = tableRows(render({ read: READ, initialView: 'table' }));
    expect(rows[0]).toEqual(['Month', 'Maple House', 'Goa Friends Trip', 'Your share']);
    expect(rows.slice(1)).toEqual([
      ['April 2026', '₹5,660.00', '– None', '₹5,660.00'],
      ['May 2026', '₹5,880.00', '– None', '₹5,880.00'],
      ['June 2026', '₹6,403.33', '– None', '₹6,403.33'],
      ['July 2026', '₹6,016.67', '– None', '₹6,016.67'],
      ['August 2026', '₹5,795.00', '– None', '₹5,795.00'],
      ['September 2026 · this month', '₹6,140.00', '₹3,280.00', '₹9,420.00'],
    ]);
  });

  it('has a caption and header cells for assistive technology', () => {
    const html = render({ read: READ, initialView: 'table' });
    expect(text(html)).toContain("Your share of spending in INR, by month, with each Group's part");
    expect(html.match(/scope="col"/g)).toHaveLength(4);
    expect(html.match(/scope="row"/g)).toHaveLength(6);
  });

  it('explains the current Month in one line', () => {
    expect(text(render({ read: READ, initialView: 'table' }))).toContain(
      'September is up because of Goa Friends Trip: ₹3,280.00 of your ₹9,420.00.',
    );
  });

  it('switches currency only when there are several, and starts with the read’s first', () => {
    const html = render({ read: READ, initialView: 'table' });
    expect(html).toContain('aria-label="Currency"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>INR</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>EUR</);
    expect(text(html)).toContain('INR · last 6 months · every Group');

    const single = render({ read: { ...READ, currencies: [READ.currencies[0]] } });
    expect(single).not.toContain('aria-label="Currency"');
  });

  it('marks the chosen view as pressed', () => {
    expect(render({ read: READ, initialView: 'table' })).toMatch(/aria-pressed="true"[^>]*>Table</);
    expect(render({ read: READ })).toMatch(/aria-pressed="true"[^>]*>Chart</);
  });
});

describe('the chart view', () => {
  it('hides the chart from assistive technology and gives it the same table', () => {
    const html = render({ read: READ, initialView: 'chart' });
    expect(html).toMatch(/<div[^>]*aria-hidden="true"[^>]*data-testid="spending-columns"/);
    expect(
      tableRows(html)
        .slice(1)
        .map((row) => row.at(-1)),
    ).toEqual(['₹5,660.00', '₹5,880.00', '₹6,403.33', '₹6,016.67', '₹5,795.00', '₹9,420.00']);
  });
});
