import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import Chip from '@mui/material/Chip';
import Checkbox from '@mui/material/Checkbox';
import ExpenseFields from '@/components/expenses/ExpenseFields';
import { entryForExpenseDraft } from '@splitbook/shared/expense-entry-draft';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import type { ExpenseDraftValues } from '@splitbook/shared/validators/expense-draft';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import ReviewExpenseFields from './ReviewExpenseFields';

/*
 * The To review editor's payer and split pickers (#591), rendered to static markup: the viewer
 * is "You", matched by member id, so two members with the same name can be told apart, and
 * nothing is filled in that the item doesn't have.
 */

const viewer = 'a00000000000000000000001';
const namesake = 'a00000000000000000000002';
const sam = 'a00000000000000000000003';

/** The editor's markup, without the `<style>` elements MUI writes between its elements. */
function render(values: ExpenseDraftValues) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(ReviewExpenseFields, {
        entry: entryForExpenseDraft(values),
        original: values,
        context: {
          currency: 'INR',
          viewerId: viewer,
          members: [
            { id: viewer, name: 'Ankit Das' },
            { id: namesake, name: 'Ankit Das' },
            { id: sam, name: 'Sam' },
          ],
          tags: [],
        },
        onChange: () => {},
      }),
    ),
  ).replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
}

/** The Paid by field: the member it shows, and the member id it holds. */
function paidBy(html: string) {
  const field =
    />Paid by<\/label><div[^>]*><div[^>]*role="combobox"[^>]*>([\s\S]*?)<\/div><input[^>]*value="([^"]*)"/.exec(
      html,
    );
  if (!field) throw new Error('No Paid by field');
  // An empty Select shows a zero-width space, so it keeps its height.
  return { shows: text(field[1]).replace(/\u200b/g, ''), holds: field[2] };
}

/** Every accessible name given with aria-label, in order, as a screen reader reads it. */
function ariaLabels(html: string) {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map(([, label]) => text(label));
}

const dinner = { description: 'Dinner', amount: 100 };

describe('the payer and split pickers in the web To review editor (#591)', () => {
  it('call only the viewer You, by member id, beside a member with the same name', () => {
    const html = render({
      ...dinner,
      paidBy: [{ user: viewer }],
      splitMethod: 'unequal',
      splitBetween: [{ user: viewer }, { user: namesake }],
    });

    expect(paidBy(html)).toEqual({ shows: 'You', holds: viewer });
    const labels = ariaLabels(html);
    expect(labels.filter((label) => label.startsWith('Share with '))).toEqual([
      'Share with You',
      'Share with Ankit Das',
      'Share with Sam',
    ]);
    expect(labels.filter((label) => label.endsWith(' share'))).toEqual([
      'Your share',
      'Ankit Das’s share',
    ]);
  });

  it('name the other Ankit Das when they paid', () => {
    const html = render({ ...dinner, paidBy: [{ user: namesake }] });

    expect(paidBy(html)).toEqual({ shows: 'Ankit Das', holds: namesake });
  });

  it('leave an item without a payer without one: the viewer is not filled in', () => {
    expect(paidBy(render(dinner))).toEqual({ shows: '', holds: '' });
  });
});

it('keeps a cleared named Tag unselected while the changed entry is being kept', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { querySelector: () => null, getElementById: () => null });
  const original = {
    description: 'Lunch',
    amount: 100,
    tag: 'Food',
    splitMethod: 'equal' as const,
    splitBetween: [{ user: viewer }, { user: sam }],
  };
  let renderer: ReactTestRenderer | undefined;
  function Form() {
    const [entry, setEntry] = useState(() => entryForExpenseDraft(original));
    const [changed, setChanged] = useState(false);
    return createElement(ReviewExpenseFields, {
      entry,
      original,
      changes: { tagId: changed },
      context: {
        currency: 'INR',
        members: [
          { id: viewer, name: 'Alex' },
          { id: sam, name: 'Sam' },
        ],
        tags: [{ id: 'c00000000000000000000001', name: 'Food' }],
      },
      onChange: (patch) => {
        setEntry((prior) => ({ ...prior, ...patch }));
        setChanged(true);
      },
    });
  }
  try {
    await act(async () => {
      renderer = create(
        createElement(ThemeProvider, { theme: createAppTheme('light') }, createElement(Form)),
      );
    });
    await act(async () => renderer!.root.findByType(ExpenseFields).props.editEntry({ tagId: '' }));
    expect(
      renderer!.root.findAllByType(Chip).find((chip) => chip.props.label === 'Food')!.props[
        'aria-pressed'
      ],
    ).toBe(false);
    await act(async () =>
      renderer!.root.findAllByType(Checkbox)[0].props.onChange({ target: { checked: false } }),
    );
    await act(async () =>
      renderer!.root.findAllByType(Checkbox)[0].props.onChange({ target: { checked: true } }),
    );
    expect(renderer!.root.findByType(ExpenseFields).props.entry.participantIds).toEqual([
      viewer,
      sam,
    ]);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    vi.unstubAllGlobals();
  }
});

it('keeps a complete split visible while Who paid needs correction (#1117 decision 8)', () => {
  expect(
    text(
      render({
        amount: 100,
        currency: 'INR',
        paidBy: [{ user: viewer, amount: 40 }],
        splitMethod: 'equal',
        splitBetween: [{ user: viewer }, { user: sam }],
      }),
    ).match(/₹50\.00/g),
  ).toHaveLength(2);
});

it('shows the leftover-cent note while reviewing (#1117 decision 9)', () => {
  expect(
    text(
      render({
        amount: 0.01,
        currency: 'INR',
        paidBy: [{ user: viewer, amount: 0.01 }],
        splitMethod: 'equal',
        splitBetween: [{ user: viewer }, { user: sam }],
      }),
    ),
  ).toContain('The leftover ₹0.01 goes to you so the total is exact.');
});
