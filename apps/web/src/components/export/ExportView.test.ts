import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig, unstable_serialize } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import type { GroupRead } from '@splitbook/shared/group-read';
import { planExportFiles } from '@splitbook/shared/export-request';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { groupReadKey } from '@/lib/group-read-key';
import { text } from '@/lib/test-utils/markup';
import {
  DEFAULT_INCLUDE,
  currencyNote,
  exportFailureMessage,
  exportGroupOptions,
  exportRequest,
  fileNameFromDisposition,
  initialCustomRange,
  initialSelection,
  periodOptions,
  periodWindow,
} from './export-form';

/*
 * The Export page (#317): its states rendered to static markup (the Groups loading, failing and
 * empty, nothing picked, a download preparing, done and failed), and what it works out from the
 * member's choices.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/export',
  useRouter: () => ({ push: vi.fn() }),
}));

const { default: ExportView, ExportPageView } = await import('./ExportView');
type ViewProps = Parameters<typeof ExportPageView>[0];

const ALEX = 'a00000000000000000000001';
const id = (n: number) => `c0000000000000000000000${n}`;

function group(n: number, name: string, category: GroupRead['category'], currency = 'INR') {
  return {
    _id: id(n),
    name,
    category,
    defaultCurrency: currency,
    members: [{ user: { _id: ALEX, name: 'Alex Rivera', email: 'alex@example.test' } }],
  } as GroupRead;
}

const GROUPS = [
  group(1, 'Maple House', 'home'),
  group(2, 'Goa Friends Trip', 'trip'),
  group(3, 'Lisbon Offsite', 'work', 'EUR'),
];
const OPTIONS = exportGroupOptions(GROUPS);
/** 30 September 2026, mid-morning on the device's calendar. */
const NOW = new Date(2026, 8, 30, 10, 42);

function render(element: ReactElement, groups?: GroupRead[], mode: 'light' | 'dark' = 'light') {
  const fallback: Record<string, unknown> = {};
  if (groups) fallback[unstable_serialize(groupReadKey(ALEX, '/api/groups'))] = { data: groups };
  return renderToStaticMarkup(
    createElement(
      SWRConfig,
      { value: { fallback } },
      createElement(ThemeProvider, { theme: createAppTheme(mode) }, element),
    ),
  );
}

/** The page in a state, with Maple House picked for this month unless the test says otherwise. */
function view(overrides: Partial<ViewProps> = {}, mode: 'light' | 'dark' = 'light') {
  const selected = overrides.selected ?? [id(1)];
  const include = overrides.include ?? DEFAULT_INCLUDE;
  const request = exportRequest({
    groups: OPTIONS,
    selected,
    window: periodWindow('this', NOW, initialCustomRange(NOW)),
    include,
    timeZone: 'Asia/Kolkata',
  });
  const names = request ? request.groupIds.map((g) => OPTIONS.find((o) => o.id === g)!.name) : [];
  const props: ViewProps = {
    groups: { status: 'ready', groups: OPTIONS },
    onRetryGroups: vi.fn(),
    selected,
    onToggleGroup: vi.fn(),
    onToggleAll: vi.fn(),
    period: 'this',
    periodOptions: periodOptions(NOW),
    onPeriod: vi.fn(),
    custom: initialCustomRange(NOW),
    onCustom: vi.fn(),
    windowError: null,
    include,
    onInclude: vi.fn(),
    plan: request ? { ...planExportFiles(names, request), groupNames: names } : null,
    currencyNote: currencyNote(OPTIONS, selected),
    download: { status: 'idle' },
    onDownload: vi.fn(),
    ...overrides,
  };
  return render(createElement(ExportPageView, props), undefined, mode);
}

/** The checkboxes in markup order: each one's label and whether it is ticked. */
function checkboxes(html: string) {
  return [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)]
    .filter(([, inner]) => inner.includes('type="checkbox"'))
    .map(([, inner]) => ({
      label: text(inner),
      checked: /<input\b[^>]*\bchecked=""/.test(inner),
    }));
}

const downloadButton = (html: string) =>
  /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Download CSV[\s\S]*?<\/button>/.exec(html)?.[0] ?? '';

describe('the Export page', () => {
  it('lists the Groups with their Theme and currency, Select all, the period, Include and the note', () => {
    const html = view();
    expect(html).toMatch(/<h1\b[^>]*>Export<\/h1>/);
    expect(checkboxes(html)).toEqual([
      { label: 'Maple House Household · INR', checked: true },
      { label: 'Goa Friends Trip Trip · INR', checked: false },
      { label: 'Lisbon Offsite Work · EUR', checked: false },
      { label: 'Payments', checked: true },
      { label: 'Shares per person', checked: true },
      { label: 'Deleted Expenses', checked: false },
      { label: 'Edit history', checked: false },
    ]);
    expect(text(html)).toContain('Select all');
    expect(html).toContain('role="group" aria-labelledby="export-groups-heading"');
    expect(html).toContain('role="group" aria-labelledby="export-include-heading"');
    expect(text(html)).toContain(
      'Amounts stay in their own currency. Splitbook never converts them.',
    );
    expect(text(html)).toContain('1–30 Sep 2026');
  });

  it('offers this month, last month, a custom range and all time', () => {
    const options = [...view().matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map(
      ([, value, label]) => [value, label],
    );
    expect(options).toEqual([
      ['this', 'September 2026 (this month)'],
      ['last', 'August 2026 (last month)'],
      ['custom', 'Custom range'],
      ['all', 'All time'],
    ]);
  });

  it('names the file it will download, and the zip when there are several files', () => {
    expect(text(view())).toContain('maple-house-2026-09.zip · 2 CSV files in a .zip');
    expect(text(view({ include: { ...DEFAULT_INCLUDE, payments: false } }))).toContain(
      'maple-house-2026-09-expenses.csv · 1 CSV file',
    );
    const all = view({ selected: OPTIONS.map((o) => o.id) });
    expect(text(all)).toContain('splitbook-3-groups-2026-09.zip · 6 CSV files in a .zip');
    expect(text(all)).toContain('Clear all');
  });

  it('lists the files and their columns, in the documented order', () => {
    const html = view({ include: { ...DEFAULT_INCLUDE, deleted: true, history: true } });
    expect(text(html)).toContain(
      'maple-house-2026-09-expenses.csv Expenses · Maple House maple-house-2026-09-payments.csv Payments · Maple House',
    );
    expect(text(html)).toContain(
      'Expenses columns Date Description Category Tag Paid by Split Amount Currency Notes ' +
        'Expense ID one share column per person Deleted at Deleted by Edited at Edited by Change',
    );
    expect(text(html)).toContain(
      'Payments columns Date Recorded at From To Amount Currency Note Recorded by Payment ID',
    );
  });

  it('says "Pick at least one Group" and keeps Download off while no Group is picked', () => {
    const html = view({ selected: [] });
    expect(text(html)).toContain('Pick at least one Group.');
    expect(downloadButton(html)).toMatch(/\bdisabled=""/);
    expect(downloadButton(html)).toContain('aria-describedby="export-file"');
    expect(html).toMatch(/id="export-file"[^>]*>Pick at least one Group\./);
    expect(text(html)).toContain('Nothing to export yet');
  });

  it('keeps Download on once a Group is picked', () => {
    expect(downloadButton(view())).not.toMatch(/\bdisabled=""/);
  });

  it('says how a custom range is unfinished, and keeps Download off', () => {
    const html = view({
      period: 'custom',
      windowError: 'The end date is before the start date.',
      plan: null,
    });
    expect(html).toContain('type="date"');
    expect(text(html)).toMatch(/From .* To /);
    expect(html).toMatch(/role="alert"[^>]*>The end date is before the start date\./);
    expect(downloadButton(html)).toMatch(/\bdisabled=""/);
  });

  it('notes when the picked Groups use different currencies', () => {
    expect(text(view({ selected: [id(1), id(3)] }))).toContain(
      'These Groups use INR and EUR. Each amount stays in its Group’s currency.',
    );
    expect(text(view({ selected: [id(1), id(2)] }))).not.toContain('These Groups use');
  });

  it('shows the download preparing, then downloading, in one status region', () => {
    const preparing = view({
      download: { status: 'preparing', fileName: 'maple-house-2026-09.zip' },
    });
    expect(preparing).toContain('role="status"');
    expect(preparing).toContain('role="progressbar"');
    // The name sits in its own span: the markup reader puts a space where a tag was.
    expect(text(preparing)).toMatch(/Preparing maple-house-2026-09\.zip ?…/);
    expect(downloadButton(preparing.replace('Preparing…', 'Download CSV'))).toMatch(
      /\bdisabled=""/,
    );

    const done = view({ download: { status: 'done', fileName: 'maple-house-2026-09.zip' } });
    expect(text(done)).toContain('maple-house-2026-09.zip is downloading.');
    expect(done).not.toContain('role="progressbar"');
  });

  it('says why a download failed, and offers Try again', () => {
    const html = view({
      download: { status: 'failed', message: 'The export couldn’t be prepared.' },
    });
    expect(html).toMatch(/role="alert"/);
    expect(text(html)).toContain('The export couldn’t be prepared.');
    expect(text(/<div\b[^>]*role="alert"[\s\S]*?<\/button>/.exec(html)![0])).toBe(
      'The export couldn’t be prepared. Try again',
    );
  });

  it('shows the Groups loading, then failing with Try again, without a form', () => {
    const loading = view({ groups: { status: 'loading' }, plan: null });
    expect(loading).toContain('role="status" aria-label="Loading your Groups"');
    expect(loading).toContain('aria-busy="true"');
    expect(text(loading)).not.toContain('Download CSV');

    const failed = view({ groups: { status: 'error' }, plan: null });
    expect(text(failed)).toContain('Your Groups could not be loaded. Try again');
    expect(text(failed)).not.toContain('Download CSV');
  });

  it('with no Groups at all, points to starting one', () => {
    const html = view({ groups: { status: 'ready', groups: [] }, selected: [], plan: null });
    expect(text(html)).toContain('No Groups to export');
    expect(html).toContain('href="/groups/new"');
  });

  it('never shows a member’s email, in light or dark', () => {
    for (const mode of ['light', 'dark'] as const)
      expect(text(view({ selected: OPTIONS.map((o) => o.id) }, mode))).not.toMatch(
        /@|example\.test/,
      );
  });

  it('picks the Group a header’s Export button named, or every Group from the sidebar', () => {
    const page = (preselectedGroupId: string | null) =>
      checkboxes(render(createElement(ExportView, { userId: ALEX, preselectedGroupId }), GROUPS))
        .slice(0, 3)
        .map((box) => box.checked);
    expect(page(id(2))).toEqual([false, true, false]);
    expect(page(null)).toEqual([true, true, true]);
    // A Group the member isn't in picks nothing.
    expect(page('f00000000000000000000000')).toEqual([false, false, false]);
  });
});

describe('the choices', () => {
  it('turn this month and last month into the device’s calendar days, December to January too', () => {
    const range = initialCustomRange(NOW);
    expect(periodWindow('this', NOW, range)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodWindow('last', NOW, range)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(periodWindow('all', NOW, range)).toEqual({});
    const january = new Date(2027, 0, 3);
    expect(periodWindow('last', january, initialCustomRange(january))).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(periodOptions(january)[1].label).toBe('December 2026 (last month)');
  });

  it('start a custom range at the month’s first day and end it today', () => {
    expect(initialCustomRange(NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(initialCustomRange(new Date(2026, 9, 7, 23, 30))).toEqual({
      from: '2026-10-01',
      to: '2026-10-07',
    });
  });

  it('refuse a custom range that is incomplete or ends before it starts', () => {
    expect(periodWindow('custom', NOW, { from: '', to: '2026-09-30' })).toEqual({
      error: 'Pick a start and an end date.',
    });
    expect(periodWindow('custom', NOW, { from: '2026-09-30', to: '2026-09-01' })).toEqual({
      error: 'The end date is before the start date.',
    });
    expect(periodWindow('custom', NOW, { from: '2026-09-02', to: '2026-09-02' })).toEqual({
      from: '2026-09-02',
      to: '2026-09-02',
    });
  });

  it('send the picked Groups in the list’s order, with what to include and the time zone', () => {
    expect(
      exportRequest({
        groups: OPTIONS,
        selected: [id(3), id(1)],
        window: { from: '2026-09-01', to: '2026-09-30' },
        include: { payments: false, shares: true, deleted: true, history: false },
        timeZone: 'Asia/Kolkata',
      }),
    ).toEqual({
      groupIds: [id(1), id(3)],
      from: '2026-09-01',
      to: '2026-09-30',
      include: ['shares', 'deleted'],
      format: 'csv',
      timeZone: 'Asia/Kolkata',
    });
    const base = { groups: OPTIONS, include: DEFAULT_INCLUDE, timeZone: 'UTC' };
    expect(exportRequest({ ...base, selected: [], window: {} })).toBeNull();
    expect(exportRequest({ ...base, selected: [id(1)], window: { error: 'x' } })).toBeNull();
  });

  it('pick a named Group whatever the case of its id', () => {
    expect(initialSelection(OPTIONS, id(2).toUpperCase())).toEqual([id(2)]);
  });

  it('read the file name a reply gives, and say why an export failed without leaking the server’s words', () => {
    expect(fileNameFromDisposition('attachment; filename="maple-house-2026-09.zip"')).toBe(
      'maple-house-2026-09.zip',
    );
    expect(fileNameFromDisposition(null)).toBeNull();
    expect(exportFailureMessage(413, { error: 'Pick fewer Groups or a shorter period.' })).toBe(
      'Pick fewer Groups or a shorter period.',
    );
    expect(exportFailureMessage(403, { error: 'Forbidden' })).toBe(
      'You can only export Groups you’re in. Reload the page to see your Groups.',
    );
    expect(exportFailureMessage(500, { error: 'Internal diagnostic' })).toBe(
      'The export couldn’t be prepared.',
    );
  });
});
