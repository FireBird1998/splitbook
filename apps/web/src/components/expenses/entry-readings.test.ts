import { recording } from '@splitbook/shared/test-support/expense-entry-recording';
import { createElement, useLayoutEffect, useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import { afterEach, expect, it, vi } from 'vitest';
import { ExpenseDraft } from '@splitbook/shared/expense-draft';
import { formatCurrency } from '@splitbook/shared/currency';
import { draftValues, type DraftEntries } from '@splitbook/shared/persistent-draft-editor';
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
  return ExpenseDraft.open(context, edit ? savedFor(row) : null).edit({
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    date: row.date,
    category: row.category,
    tag: row.tagId,
    notes: row.notes,
    splitMethod: row.splitMethod,
    selectedMembers: row.participantIds,
    payers: row.payers,
    multiPayerMode: row.multiPayer,
    customAmounts: ['unequal', 'exact'].includes(row.splitMethod) ? row.splitValues : {},
    customPercentages: row.splitMethod === 'percentage' ? row.splitValues : {},
    customShares: row.splitMethod === 'shares' ? row.splitValues : {},
  });
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
      return row ? formatCurrency(row.amount, draft.values.currency) : '—';
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
            values: draft.values,
            edit: () => {},
            chooseSplitMethod: () => {},
            members,
            groupTags: tags,
            userId: alex,
            isEditMode: edit,
            previewAmount: (id) => perPerson.find((p) => p.user === id)!.amount,
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
    let input: DraftEntries = {};
    function Form() {
      const [entries, setEntries] = useState<DraftEntries>({});
      useLayoutEffect(() => {
        input = entries;
      });
      return createElement(ReviewExpenseFields, {
        entries,
        context: {
          members: people,
          tags: tags.map((t) => ({ id: t._id, name: t.name })),
          currency: 'INR',
          category: 'home',
          viewerId: alex,
        },
        onChange: (patch) => setEntries((previous) => ({ ...previous, ...patch })),
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
    await act(async () => renderer!.root.findByType(ExpenseFields).props.edit(open(row).values));
    let result: Reading['result'];
    try {
      result = { kind: 'draft', value: draftValues(input) };
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
