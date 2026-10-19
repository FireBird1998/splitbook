import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import type { ExportPreview } from '@splitbook/shared/export-preview';
import ExportPreviewPanel, { type PreviewState } from './ExportPreview';

const csv: ExportPreview = {
  format: 'csv',
  groupNames: ['Maple House'],
  generatedAt: '2026-10-19T06:00:00.000Z',
  from: '2026-09-01',
  to: '2026-09-30',
  timeZone: 'UTC',
  empty: false,
  fileName: 'maple.csv',
  files: [
    {
      name: 'maple.csv',
      kind: 'expenses',
      header: ['Description', 'Amount', 'Currency'],
      rows: [['Groceries', '10.01', 'INR']],
      totalRows: 8,
    },
  ],
};
function render(state: PreviewState) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(ExportPreviewPanel, { state, onRetry: vi.fn() }),
    ),
  );
}
describe('Export preview panel (#611)', () => {
  it('shows the CSV headers, exact first cells and remaining row count', () => {
    const html = render({ status: 'ready', data: csv });
    expect(text(html)).toContain('Preview');
    expect(text(html)).toContain('Maple House · September 2026 · CSV');
    expect(html).toContain('<th');
    expect(text(html)).toContain('Description Amount Currency');
    expect(text(html)).toContain('Groceries 10.01 INR');
    expect(text(html)).toContain('…and 7 more rows');
    expect(html).toContain('tabindex="0"');
  });
});

it('keeps no-selection, loading, empty and retryable preview failures distinct', () => {
  expect(text(render({ status: 'idle', message: 'Pick at least one Group.' }))).toContain(
    'Pick at least one Group.',
  );
  const loading = render({ status: 'loading' });
  expect(loading).toContain('aria-busy="true"');
  expect(text(loading)).toContain('Loading preview…');
  const failure = render({ status: 'error', message: 'Preview could not be loaded.' });
  expect(failure).toContain('role="alert"');
  expect(text(failure)).toContain('Preview could not be loaded.');
  expect(text(failure)).toContain('Retry');
  const empty = render({ status: 'ready', data: { ...csv, empty: true, files: [] } });
  expect(text(empty)).toContain('Nothing to export for this period.');
  expect(empty).not.toContain('<table');
});

it('shows backup file counts and labels unsupported categories as not exported', () => {
  const html = render({
    status: 'ready',
    data: {
      format: 'json',
      groupNames: ['Maple House'],
      generatedAt: '2026-10-19T06:00:00.000Z',
      from: null,
      to: null,
      timeZone: 'UTC',
      empty: false,
      fileName: 'splitbook-1-groups-backup.json',
      sizeBytes: 1200,
      earliestMonth: '2026-04',
      historyIncluded: true,
      counts: {
        members: 3,
        expenses: 86,
        payments: 3,
        deletedExpenses: 1,
        editHistoryEntries: 4,
        recurringExpenses: 0,
        activityEvents: 0,
      },
      unsupported: ['recurringExpenses', 'activityEvents'],
    },
  });
  expect(text(html)).toContain('splitbook-1-groups-backup.json');
  expect(text(html)).toContain('Approximately 1,200 bytes');
  expect(text(html)).toContain('3 Members');
  expect(text(html)).toContain('86 Expenses since April 2026, each with its edit history');
  expect(text(html)).toContain('3 Payments');
  expect(text(html)).toContain('1 Deleted Expense');
  expect(text(html)).toContain('0 Recurring Expenses exported');
  expect(text(html)).toContain(
    'Recurring Expenses and Activity events are not included in this backup format.',
  );
});

it('renders statement period figures, named people and bounded expense rows as a document', () => {
  const html = render({
    status: 'ready',
    data: {
      ...csv,
      format: 'statement',
      statement: {
        id: 'maple',
        name: 'Maple House',
        theme: 'home',
        defaultCurrency: 'INR',
        from: csv.from,
        to: csv.to,
        timeZone: 'UTC',
        currencies: [
          {
            currency: 'INR',
            spentMinor: 7007,
            expenseCount: 7,
            paymentTotalMinor: 1000,
            paymentCount: 1,
            people: [
              {
                id: 'alice',
                name: 'Alice Tester',
                paidMinor: 7007,
                shareMinor: 3504,
                netMinor: 3503,
              },
            ],
            expenses: [
              {
                id: 'expense',
                date: '2026-09-01',
                description: 'Groceries',
                tag: 'Food',
                amountMinor: 1001,
              },
            ],
          },
        ],
      },
    },
  });
  expect(text(html)).toContain('Maple House · Statement · September 2026');
  expect(text(html)).toContain('Household · INR · Generated');
  expect(text(html)).toContain('Generated');
  expect(text(html)).toContain('Spent');
  expect(text(html)).toContain('70.07');
  expect(text(html)).toContain('Member Paid Share Net');
  expect(text(html)).toContain('Alice Tester');
  expect(text(html)).not.toContain('You');
  expect(text(html)).toContain('Groceries');
  expect(text(html)).toContain('…and 6 more Expenses');
  expect(text(html)).toContain('Amounts in INR, never converted');
});
