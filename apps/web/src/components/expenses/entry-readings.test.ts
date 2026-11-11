import { draftEntryCases } from '@splitbook/shared/test-support/draft-entry-cases';
import { recording } from '@splitbook/shared/test-support/expense-entry-recording';
import { createElement, useLayoutEffect, useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import { afterEach, expect, it, vi } from 'vitest';
import { ExpenseDraft } from '@splitbook/shared/expense-draft';
import { formatCurrency } from '@splitbook/shared/currency';
import { entryForExpenseDraft, draftForExpenseEntry } from '@splitbook/shared/expense-entry-draft';
import type { IncompleteExpenseEntry } from '@splitbook/shared/expense-entry';
import type { ExpenseDraftValues as NumericDraft } from '@splitbook/shared/validators/expense-draft';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { useKeepExpenseDraft } from '@/components/drafts/KeepExpenseDraft';
import ReviewExpenseFields from '@/components/to-review/ReviewExpenseFields';
import ExpenseFields from './ExpenseFields';
import {
  entries,
  alex,
  day,
  groupId,
  tagId,
  people,
  savedFor,
  refusal,
  type TypedEntry,
  type Reading,
} from '@splitbook/shared/test-support/expense-entry-cases';

type ReviewInput = {
  entry: IncompleteExpenseEntry;
  from: NumericDraft;
  changed: Partial<Record<keyof IncompleteExpenseEntry, boolean>>;
};
const reviewInput = (from: NumericDraft = {}): ReviewInput => ({
  entry: entryForExpenseDraft(from),
  from,
  changed: {},
});
const changeReview = (prior: ReviewInput, patch: Partial<IncompleteExpenseEntry>): ReviewInput => ({
  ...prior,
  entry: { ...prior.entry, ...patch },
  changed: {
    ...prior.changed,
    ...Object.fromEntries(Object.keys(patch).map((key) => [key, true])),
  },
});
const reviewValue = (input: ReviewInput) => draftForExpenseEntry(input.entry, input);

const context = {
  groupId,
  accountId: alex,
  memberIds: people.map((p) => p.id),
  currency: 'INR',
  defaultTag: tagId,
  date: day,
};
const members = people.map((p) => ({ user: { _id: p.id, name: p.name } }));
const tags = [{ _id: tagId, name: 'Shared', isArchived: false }];
function open(row: TypedEntry, edit = false) {
  return ExpenseDraft.open(context, edit ? savedFor(row) : null).change(row);
}
/** Text only, retaining no-break spaces (part of the form's own words). */
function text(html: string) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[\t\r\n ]+/g, ' ')
    .trim();
}
function renderFields(draft: ExpenseDraft, edit: boolean) {
  const preview = draft.preview();
  const perPerson = people.map((p) => ({
    user: p.id,
    amount: (() => {
      const row = preview.money?.splitBetween.find((r) => r.user === p.id);
      return row ? formatCurrency(row.amount, draft.entry.currency) : '—';
    })(),
  }));
  return {
    preview,
    perPerson,
    advancedInitiallyOpen: edit,
    // Collapse retains these contents; this also records the totals available on opening it.
    formContents: text(
      renderToStaticMarkup(
        createElement(
          ThemeProvider,
          { theme: createAppTheme('light') },
          createElement(ExpenseFields, {
            entry: draft.entry,
            reading: draft.reading(),
            editEntry: () => {},
            chooseSplitMethod: () => {},
            members,
            groupTags: tags,
            userId: alex,
            isEditMode: edit,
          }),
        ),
      ),
    ),
    roundingNote: null,
  };
}
for (const edit of [false, true]) {
  it(
    'records the web ' + (edit ? 'edit' : 'new') + ' form reading and displayed totals (#1111)',
    async () => {
      const cells: Record<string, Reading> = {};
      for (const row of entries) {
        if (row.savedZeroPayer && !edit) {
          cells[row.id] = unsupported();
          continue;
        }
        const draft = open(row, edit);
        const prepared = draft.prepare([tagId], 'entry-reading-key');
        cells[row.id] = {
          result: prepared.submission
            ? { kind: 'command', value: JSON.parse(prepared.submission.body) }
            : { kind: 'refusal', issues: [{ field: '', message: prepared.draft.error }] },
          shown: renderFields(draft, edit),
        };
      }
      await expect(await recording(cells)).toMatchFileSnapshot(
        '../../../../../test/expense-entry-readings/recordings/web-' +
          (edit ? 'edit' : 'new') +
          '.json',
      );
    },
  );
}
function unsupported(): Reading {
  return {
    result: {
      kind: 'unsupported',
      reason: 'This entry requires a saved Expense; this column creates a Draft or a new Expense.',
    },
  };
}

it('records the web To review editor and the Draft it reads (#1111)', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { querySelector: () => null, getElementById: () => null });
  const words = (node: ReactTestInstance): string =>
    node.type === 'style'
      ? ''
      : node.children
          .map((child) => (typeof child === 'string' ? child : ' ' + words(child) + ' '))
          .join('')
          .replace(/[\t\r\n ]+/g, ' ')
          .trim();
  const cells: Record<string, Reading> = {};
  for (const row of entries) {
    if (row.savedZeroPayer) {
      cells[row.id] = unsupported();
      continue;
    }
    let input = reviewInput();
    function Form() {
      const [current, setCurrent] = useState(input);
      useLayoutEffect(() => {
        input = current;
      });
      return createElement(ReviewExpenseFields, {
        entry: current.entry,
        original: current.from,
        changes: current.changed,
        context: {
          members: people,
          tags: tags.map((t) => ({ id: t._id, name: t.name })),
          currency: 'INR',
          category: 'home',
          viewerId: alex,
        },
        onChange: (patch) => setCurrent((previous) => changeReview(previous, patch)),
      });
    }
    await act(async () => {
      renderer = create(
        createElement(ThemeProvider, { theme: createAppTheme('light') }, createElement(Form)),
      );
    });
    await act(async () =>
      renderer!.root.findByType(ExpenseFields).props.chooseSplitMethod(row.splitMethod),
    );
    // The same whole typed change given to Android's public reviewFormChange seam.
    await act(async () =>
      renderer!.root.findByType(ExpenseFields).props.editEntry(open(row).entry),
    );
    let result: Reading['result'];
    try {
      result = { kind: 'draft', value: reviewValue(input) };
    } catch (error) {
      result = refusal(error);
    }
    cells[row.id] = {
      result,
      shown: {
        formContents: words(renderer!.root),
        fields: renderer!.root.findAllByType('input').map((n) => ({
          label: n.props['aria-label'] ?? '',
          value: n.props.value ?? '',
          type: n.props.type,
        })),
        roundingNote: null,
      },
    };
    await act(async () => renderer!.unmount());
    renderer = undefined;
  }
  await expect(await recording(cells)).toMatchFileSnapshot(
    '../../../../../test/expense-entry-readings/recordings/web-review.json',
  );
});

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) {
    await act(async () => renderer!.unmount());
    renderer = undefined;
  }
  vi.unstubAllGlobals();
});
it('records web Finish later through its real hook and request (#1111)', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const cells: Record<string, Reading> = {};
  for (const row of entries) {
    if (row.savedZeroPayer) {
      cells[row.id] = unsupported();
      continue;
    }
    const stored = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, v),
      removeItem: (k: string) => stored.delete(k),
    });
    let sent: unknown;
    vi.stubGlobal('fetch', async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        sent = JSON.parse(String(init.body)).drafts[0];
        return Response.json(
          {
            data: [
              {
                id: 'e00000000000000000000001',
                groupId,
                revision: 0,
                state: 'active',
                preparedBy: { kind: 'member' },
                changedBy: { kind: 'member' },
                values: sent,
                missingFields: [],
                createdAt: day + 'T00:00:00.000Z',
                updatedAt: day + 'T00:00:00.000Z',
              },
            ],
          },
          { status: 201 },
        );
      }
      return Response.json({ data: [] });
    });
    let state!: ReturnType<typeof useKeepExpenseDraft>;
    const draft = open(row);
    function Form() {
      const current = useKeepExpenseDraft({
        draft,
        groupId,
        accountId: alex,
        onKept: () => {},
        enabled: true,
      });
      useLayoutEffect(() => {
        state = current;
      });
      return null;
    }
    await act(async () => {
      renderer = create(
        createElement(SWRConfig, { value: { provider: () => new Map() } }, createElement(Form)),
      );
    });
    await act(async () => {
      await state.keep();
    });
    cells[row.id] = {
      result: sent
        ? { kind: 'draft', value: sent }
        : { kind: 'refusal', issues: [{ field: '', message: state.error }] },
      shown: { error: state.error, pending: state.pending, disabled: state.disabled },
    };
    await act(async () => renderer!.unmount());
    renderer = undefined;
  }
  await expect(await recording(cells)).toMatchFileSnapshot(
    '../../../../../test/expense-entry-readings/recordings/web-finish-later.json',
  );
});

it('records review edits of extra split facts and repeated people (#1115)', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { querySelector: () => null, getElementById: () => null });
  const cells: Record<string, unknown> = {};
  for (const row of draftEntryCases) {
    let input = reviewInput(row.values);
    function Form() {
      const [current, setCurrent] = useState(input);
      useLayoutEffect(() => {
        input = current;
      });
      return createElement(ReviewExpenseFields, {
        entry: current.entry,
        original: current.from,
        changes: current.changed,
        context: { members: people, tags: [], currency: 'INR' },
        onChange: (patch) => setCurrent((prior) => changeReview(prior, patch)),
      });
    }
    await act(async () => {
      renderer = create(
        createElement(ThemeProvider, { theme: createAppTheme('light') }, createElement(Form)),
      );
    });
    const payers = renderer!.root.findByType(ExpenseFields).props.entry.payers;
    await act(async () =>
      renderer!.root
        .findByType(ExpenseFields)
        .props.editEntry(
          row.change === 'shares'
            ? { splitValues: { [alex]: '2', [people[1].id]: '1' } }
            : { notes: 'Checked' },
        ),
    );
    cells[row.id] = { payers, result: reviewValue(input) };
    await act(async () => renderer!.unmount());
    renderer = undefined;
  }
  await expect(await recording(cells)).toMatchFileSnapshot(
    '../../../../../test/expense-entry-readings/supplemental/web-review.json',
  );
});

it('starts review Shares at one and fills a newly ticked person’s box (#1117 decision 1)', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { querySelector: () => null, getElementById: () => null });
  let tree!: ReactTestRenderer;
  function Form() {
    const [entry, setEntry] = useState(() =>
      entryForExpenseDraft({
        amount: 100,
        currency: 'INR',
        splitMethod: 'equal',
        paidBy: [{ user: alex, amount: 100 }],
        splitBetween: [{ user: alex }],
      }),
    );
    return createElement(ReviewExpenseFields, {
      entry,
      original: {},
      context: { members: people, tags: [], currency: 'INR' },
      onChange: (patch) => setEntry((prior) => ({ ...prior, ...patch })),
    });
  }
  await act(async () => {
    tree = create(
      createElement(ThemeProvider, { theme: createAppTheme('light') }, createElement(Form)),
    );
  });
  try {
    await act(async () => tree.root.findByType(ExpenseFields).props.chooseSplitMethod('shares'));
    expect(tree.root.findByType(ExpenseFields).props.entry.splitValues[alex]).toBe('1');
    const check = tree.root.findAll(
      (node) =>
        typeof node.props.onChange === 'function' &&
        node.props.checked === false &&
        node.props.slotProps?.input?.['aria-label'] === `Share with ${people[1].name}`,
    )[0];
    await act(async () => check.props.onChange({ target: { checked: true } }));
    expect(tree.root.findByType(ExpenseFields).props.entry.splitValues[people[1].id]).toBe('1');
  } finally {
    await act(async () => tree.unmount());
  }
});
