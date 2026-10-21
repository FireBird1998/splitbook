import { createElement, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExpenseDraft } from '@splitbook/shared/expense-draft';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import ExpenseFields from './ExpenseFields';

let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { querySelector: () => null, getElementById: () => null });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

it.each(['INR', 'EUR', 'JPY'])(
  'groups the Expense, payer and share in %s only after blur, preserving the draft',
  async (currency) => {
    const initial = currency === 'JPY' ? '1842' : '1842.5';
    const shown = currency === 'JPY' ? '1,842' : '1,842.50';
    const draft = ExpenseDraft.open({
      groupId: 'g',
      accountId: 'you',
      memberIds: ['you', 'sam'],
      currency,
      defaultTag: 'General',
      date: '2026-10-21',
    }).edit({
      amount: initial,
      multiPayerMode: true,
      payers: [{ user: 'you', amount: initial }],
      splitMethod: 'exact',
      customAmounts: { you: initial, sam: '0' },
    });
    function Form() {
      const [current, setCurrent] = useState(draft);
      return createElement(ExpenseFields, {
        values: current.values,
        edit: (change) => {
          setCurrent(current.edit(change));
        },
        chooseSplitMethod: () => {},
        members: [
          { user: { _id: 'you', name: 'Alex Rivera' } },
          { user: { _id: 'sam', name: 'Sam Chen' } },
        ],
        groupTags: [],
        userId: 'you',
        isEditMode: false,
        review: true,
        previewAmount: () => '',
      });
    }
    await act(async () => {
      renderer = create(
        createElement(ThemeProvider, { theme: createAppTheme('light') }, createElement(Form)),
      );
    });
    const inputs = () => renderer.root.findAllByType('input');
    const field = (kind: number) =>
      kind === 0
        ? inputs().find((n) => n.props.required && n.props.type !== 'date' && n.props.value !== '')!
        : inputs().find(
            (n) => n.props['aria-label'] === (kind === 1 ? 'Paid by You' : 'Your share'),
          )!;
    // Locate Amount through its required money value, not the Description field.
    for (const kind of [0, 1, 2]) {
      expect(field(kind).props.value).toBe(shown);
      expect(field(kind).props.type).toBe('text');
      expect(field(kind).props.inputMode).toBe(currency === 'JPY' ? 'numeric' : 'decimal');
      await act(async () => field(kind).props.onFocus?.({}));
      await act(async () => field(kind).props.onChange({ target: { value: initial } }));
      expect(field(kind).props.value).toBe(initial);
      await act(async () => field(kind).props.onBlur?.({}));
      expect(field(kind).props.value).toBe(shown);
      const stored = () =>
        kind === 0
          ? renderer.root.findByType(ExpenseFields).props.values.amount
          : kind === 1
            ? renderer.root.findByType(ExpenseFields).props.values.payers[0].amount
            : renderer.root.findByType(ExpenseFields).props.values.customAmounts.you;
      expect(stored()).toBe(initial);
      await act(async () => field(kind).props.onFocus?.({}));
      await act(async () => field(kind).props.onChange({ target: { value: shown } }));
      expect(stored()).toBe(currency === 'JPY' ? '1842' : '1842.50');
      await act(async () => field(kind).props.onBlur?.({}));
    }
  },
);
