import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { ExpenseDraft } from '@splitbook/shared/expense-draft';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import ExpenseFields from './ExpenseFields';

/*
 * The Expense form's fields (Add expense, editing an Expense, and To review's editor), rendered
 * to static markup as the server renders them. Fictional people and amounts.
 */

const YOU = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';

function render(amount: string, mode: { isEditMode?: boolean; review?: boolean } = {}) {
  const draft = ExpenseDraft.open({
    groupId: 'b00000000000000000000001',
    accountId: YOU,
    memberIds: [YOU, SAM],
    currency: 'INR',
    defaultTag: 'General',
    date: '2026-10-18',
  }).edit({ description: 'Chai', amount });
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(ExpenseFields, {
        values: draft.values,
        edit: () => {},
        chooseSplitMethod: () => {},
        members: [
          { user: { _id: YOU, name: 'Alex Rivera' } },
          { user: { _id: SAM, name: 'Sam Chen' } },
        ],
        groupTags: [{ _id: 'c00000000000000000000001', name: 'General', isArchived: false }],
        userId: YOU,
        isEditMode: mode.isEditMode ?? false,
        review: mode.review,
        previewAmount: () => '—',
      }),
    ),
  );
}

/** The amount field: whether it's marked invalid, and the message it points to, if any. */
function amountField(html: string) {
  const input = /<input\b[^>]*\stype="number"[^>]*>/.exec(html)![0];
  const described = /\saria-describedby="([^"]*)"/.exec(input)?.[1];
  const reason = /<p\b([^>]*\saria-live="polite"[^>]*)>([\s\S]*?)<\/p>/.exec(html);
  return {
    invalid: /\saria-invalid="true"/.test(input),
    describedBy: !!described && !!reason && reason[1].includes(`id="${described}"`),
    reason: reason ? text(reason[2]) : null,
  };
}

describe('the Expense amount (#528)', () => {
  it('says why it won’t take an amount, in Record payment’s words, announced politely', () => {
    for (const [amount, reason] of [
      ['0', 'Enter an amount above ₹0.00.'],
      ['-5', 'Enter an amount above ₹0.00.'],
      ['1.234', 'Use at most 2 decimal places.'],
      ['20000000', 'Enter at most ₹10,000,000.00.'],
    ])
      expect(amountField(render(amount)), amount).toEqual({
        invalid: true,
        describedBy: true,
        reason,
      });
  });

  it('says the same when editing an Expense and in To review’s editor', () => {
    for (const mode of [{ isEditMode: true }, { review: true }])
      expect(amountField(render('1.234', mode)), JSON.stringify(mode)).toEqual({
        invalid: true,
        describedBy: true,
        reason: 'Use at most 2 decimal places.',
      });
  });

  it('keeps its message region, empty, while the amount is fine or not typed yet', () => {
    for (const amount of ['100', ''])
      expect(amountField(render(amount)), amount).toEqual({
        invalid: false,
        describedBy: false,
        reason: '',
      });
  });
});
