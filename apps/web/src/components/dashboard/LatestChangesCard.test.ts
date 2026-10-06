import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { formatDateTime } from '@splitbook/shared/date';
import { parseUserActivityResponse } from '@splitbook/shared/user-activity-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { anchors, text } from '@/lib/test-utils/markup';
import LatestChangesCard, {
  LATEST_CHANGES_KEY,
  LatestChangesView,
  type LatestChangesState,
} from './LatestChangesCard';

/*
 * Home's latest changes (#309), rendered to static markup: the card's loading, empty and error
 * states, and how each change reads, with its amount and where it leads.
 */

const ALEX = 'a00000000000000000000001';
const maple = { _id: 'b00000000000000000000001', name: 'Maple House' };
const goa = { _id: 'b00000000000000000000002', name: 'Goa Friends Trip' };
const times = {
  groceries: '2026-10-06T03:44:00.000Z',
  wifi: '2026-10-05T14:10:00.000Z',
  payment: '2026-09-27T09:30:00.000Z',
  joined: '2026-09-20T07:00:00.000Z',
};

/** The latest changes as the server sends them, through the decoder the card's fetcher runs. */
const READ = parseUserActivityResponse({
  status: 200,
  data: {
    limit: 10,
    activities: [
      {
        _id: 'e00000000000000000000001',
        type: 'expense_added',
        createdAt: times.groceries,
        group: maple,
        actor: { _id: ALEX, name: 'Alex Rivera' },
        currency: 'INR',
        metadata: {
          expenseId: 'c00000000000000000000001',
          description: 'Weekly groceries',
          amount: 1249.5,
          currency: 'INR',
        },
      },
      {
        _id: 'e00000000000000000000002',
        type: 'expense_updated',
        createdAt: times.wifi,
        group: maple,
        actor: { _id: 'a00000000000000000000003', name: 'Priya Shah' },
        currency: 'INR',
        metadata: {
          expenseId: 'c00000000000000000000002',
          description: 'Wi-Fi',
          changes: { amount: { old: 899, new: 999 }, amountMinor: { old: 89900, new: 99900 } },
        },
      },
      {
        _id: 'e00000000000000000000003',
        type: 'settlement_recorded',
        createdAt: times.payment,
        group: goa,
        actor: { _id: 'a00000000000000000000002', name: 'Sam Chen' },
        currency: 'EUR',
        metadata: {
          amount: 12.5,
          currency: 'EUR',
          paidByName: 'Sam Chen',
          paidToName: 'Alex Rivera',
        },
      },
      {
        _id: 'e00000000000000000000004',
        type: 'member_joined',
        createdAt: times.joined,
        group: goa,
        actor: null,
        metadata: { method: 'invite' },
      },
    ],
  },
});

function render(element: ReactElement, mode: 'light' | 'dark' = 'light', fallback = {}) {
  return renderToStaticMarkup(
    createElement(
      SWRConfig,
      { value: { fallback } },
      createElement(ThemeProvider, { theme: createAppTheme(mode) }, element),
    ),
  );
}

const view = (state: LatestChangesState, onRetry = vi.fn(), mode: 'light' | 'dark' = 'light') =>
  render(createElement(LatestChangesView, { state, viewerId: ALEX, onRetry }), mode);

/** Each change's link: where it leads and how it reads, hidden words included. */
const rows = (html: string) => anchors(html).map(({ href, text }) => ({ href, text }));

describe('Home’s latest changes', () => {
  it('reads newest first: who did what, to which Expense, in which Group, when, and the amount', () => {
    expect(rows(view({ status: 'ready', activities: READ.activities }))).toEqual([
      {
        href: `/groups/${maple._id}`,
        text: `AR You added Weekly groceries Maple House · ${formatDateTime(times.groceries)} ₹1,249.50`,
      },
      {
        href: `/groups/${maple._id}`,
        text: `PS Priya Shah edited Wi-Fi Maple House · ${formatDateTime(times.wifi)} from ₹899.00 → to ₹999.00`,
      },
      {
        href: `/groups/${goa._id}`,
        text: `SC Sam Chen recorded a payment Goa Friends Trip · ${formatDateTime(times.payment)} €12.50`,
      },
      {
        href: `/groups/${goa._id}`,
        text: `Someone joined the Group Goa Friends Trip · ${formatDateTime(times.joined)}`,
      },
    ]);
  });

  it('shows an edit as “old → new”, and reads it aloud as “from old to new”', () => {
    const html = view({ status: 'ready', activities: READ.activities });
    expect(html).toContain('<span aria-hidden="true"> →</span>');
    const edit = /<a\b[^>]*>(?:(?!<\/a>)[\s\S])*Wi-Fi[\s\S]*?<\/a>/.exec(html)?.[0] ?? '';
    // The arrow is hidden from screen readers; "from" and "to" are hidden from sight.
    const spoken = text(edit.replace(/<span aria-hidden="true">[^<]*<\/span>/g, ''));
    expect(spoken).toContain('from ₹899.00 to ₹999.00');
    // Hidden words take one pixel; a full-size hidden box would stretch the page below Home.
    const hidden = /class="[^"]*\b((?:css|mui)-[\w-]+)"[^>]*>from /.exec(edit)?.[1];
    expect(hidden).toBeDefined();
    expect(html).toMatch(new RegExp(`\\.${hidden}\\{position:absolute;width:1px;height:1px;`));
  });

  it('marks each time for machines, in the change’s own instant', () => {
    const html = view({ status: 'ready', activities: READ.activities });
    expect([...html.matchAll(/<time dateTime="([^"]+)"/g)].map(([, at]) => at)).toEqual(
      Object.values(times),
    );
  });

  it('is a labelled region with a list of links, and no “All activity” link', () => {
    const html = view({ status: 'ready', activities: READ.activities });
    expect(html).toMatch(/<section\b[^>]*aria-labelledby="latest-changes-heading"/);
    expect(html).toMatch(/<h2\b[^>]*id="latest-changes-heading"[^>]*>Latest changes<\/h2>/);
    expect(html.match(/<li\b/g)).toHaveLength(4);
    expect(text(html)).not.toContain('All activity');
  });

  it('announces that it is loading, and claims no changes yet', () => {
    const html = view({ status: 'loading' });
    expect(html).toContain('role="status" aria-label="Loading latest changes"');
    expect(text(html)).toBe('Latest changes');
    expect(anchors(html)).toEqual([]);
  });

  it('says plainly when there are no changes yet', () => {
    const html = view({ status: 'ready', activities: [] });
    expect(text(html)).toBe(
      'Latest changes No changes yet Expenses, payments and members joining any of your Groups will show here.',
    );
    expect(html).not.toContain('role="alert"');
  });

  it('says when it could not load, without any server detail, and offers Try again', () => {
    const html = view({ status: 'error' });
    expect(html).toContain('role="alert"');
    expect(text(html)).toBe('Latest changes Latest changes could not be loaded. Try again');
    expect(html).toMatch(/<button\b[^>]*>Try again/);
  });

  it('renders every state in dark mode too', () => {
    for (const state of [
      { status: 'loading' },
      { status: 'error' },
      { status: 'ready', activities: [] },
      { status: 'ready', activities: READ.activities },
    ] satisfies LatestChangesState[])
      expect(text(view(state, vi.fn(), 'dark'))).toContain('Latest changes');
  });
});

describe('the card on Home', () => {
  it('reads the latest 10 changes across the member’s Groups', () => {
    expect(LATEST_CHANGES_KEY).toBe('/api/user/activity?limit=10');
  });

  it('shows the read’s changes once it has them, and loading until then', () => {
    const card = createElement(LatestChangesCard, { userId: ALEX });
    const loaded = render(card, 'light', { [LATEST_CHANGES_KEY]: READ });
    expect(rows(loaded)).toHaveLength(4);
    expect(text(loaded)).toContain('You added Weekly groceries');
    expect(render(card)).toContain('aria-label="Loading latest changes"');
  });
});
