import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { SplitSheet } from '../ui/split-sheet';
import { PayerSheet, paidBySummary } from '../ui/payer-sheet';
import { recording } from '@splitbook/shared/test-support/expense-entry-recording';
import { afterEach, expect, it, vi } from 'vitest';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { payerRemainder } from '@splitbook/shared/payer-remainder';
import { expenseDifferences } from '@splitbook/shared/expense-review';
import {
  buildExpenseBody,
  buildExpensePatch,
  expenseMoney,
  rebaseExpenseDraft,
  parseExpenseContext,
  validateExpenseDraft,
  type ExpenseDraft,
} from './expense-draft';
import { expenseRecordSchema } from './expense-record';
import { previewSplit, roundingNote } from './expense-split';
import { payerEntryError } from './payer-remainder';
import { reviewForm, reviewFormChange } from './review-form';
import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import {
  entries,
  day,
  groupId,
  tagId,
  savedFor,
  savedExpense,
  people,
  refusal,
  type Reading,
} from '@splitbook/shared/test-support/expense-entry-cases';

const moneyText = (minor: number, currency: string) =>
  formatCurrency(toMajorAmount(minor, currency), currency);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function world() {
  const server = fakeSplitbook();
  server.world.groups = server.world.groups.map((group) => ({
    ...group,
    tags: [{ _id: tagId, name: 'Shared', isArchived: false, createdAt: day + 'T00:00:00.000Z' }],
  }));
  return server;
}
const words = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : ' ' + words(child) + ' '))
    .join('')
    .replace(/[\t\r\n ]+/g, ' ')
    .trim();
async function sheets(draft: ExpenseDraft) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let renderer!: ReturnType<typeof create>;
  const common = {
    visible: true,
    draft,
    members: people,
    currentUserId: people[0].id,
    locked: false,
    persistence: 'saved' as const,
    name: (id: string) => people.find((p) => p.id === id)!.name,
    onChange: () => {},
    onDone: () => {},
  };
  await act(async () => {
    renderer = create(
      createElement(
        'reading-sheets',
        {},
        createElement(
          'split-sheet',
          { testID: 'reading-split' },
          createElement(SplitSheet, {
            ...common,
            money: (minor) => moneyText(minor, draft.currency),
          }),
        ),
        createElement(
          'payer-sheet',
          { testID: 'reading-payer' },
          createElement(PayerSheet, common),
        ),
      ),
    );
  });
  const result = {
    split: words(renderer.root.findByProps({ testID: 'reading-split' })),
    payers: words(renderer.root.findByProps({ testID: 'reading-payer' })),
  };
  await act(async () => renderer.unmount());
  return result;
}
async function shown(draft: ExpenseDraft) {
  const split = previewSplit(draft);
  return {
    sheets: await sheets(draft),
    paidBySummary: paidBySummary(draft, (id) =>
      id === people[0].id ? 'You' : people.find((p) => p.id === id)!.name,
    ),
    split,
    roundingNote:
      split.status.kind === 'adds-up' && split.status.leftover
        ? roundingNote(
            split.status.leftover,
            (id) => (id === people[0].id ? 'you' : people.find((p) => p.id === id)!.name),
            (minor) => moneyText(minor, draft.currency),
          )
        : null,
    payers: {
      visible: draft.multiPayer,
      ...payerRemainder(draft),
      errors: Object.fromEntries(
        draft.payers
          .map((p) => [p.user, payerEntryError(p.amount, draft.currency)])
          .filter(([, error]) => error),
      ),
    },
  };
}
const unsupportedEdit = (): Reading => ({
  result: {
    kind: 'unsupported',
    reason: 'This entry requires a saved Expense; this column creates one.',
  },
});

for (const edit of [false, true]) {
  it(
    'records Android ' + (edit ? 'edit' : 'new') + ' commands, corrections and sheets (#1111)',
    async () => {
      const server = world();
      const context = parseExpenseContext({ status: 200, data: server.world.groups[0] });
      const cells: Record<string, Reading> = {};
      for (const row of entries) {
        if (row.savedZeroPayer && !edit) {
          cells[row.id] = unsupportedEdit();
          continue;
        }
        const draft: ExpenseDraft = {
          ...row,
          ...(edit ? { original: expenseRecordSchema.parse(savedFor(row)) } : {}),
        };
        let result: Reading['result'];
        try {
          result = {
            kind: 'command',
            value: JSON.parse(
              edit ? buildExpensePatch(draft, context) : buildExpenseBody(draft, context),
            ),
          };
        } catch (error) {
          result = refusal(error);
        }
        cells[row.id] = {
          result,
          shown: {
            ...(await shown(draft)),
            ...(row.savedZeroPayer === 'conflict'
              ? {
                  conflictReview: rebaseExpenseDraft(
                    draft,
                    expenseRecordSchema.parse({ ...savedExpense, revision: 2 }),
                  ).review,
                }
              : {}),
            corrections: validateExpenseDraft(draft, context, day),
            ...(edit
              ? {
                  payerDifferencesWithoutZero: expenseDifferences(draft, {
                    ...draft,
                    payers: draft.payers.filter((p) => p.amount !== '0'),
                  }),
                  money: (() => {
                    try {
                      return expenseMoney(draft);
                    } catch {
                      return null;
                    }
                  })(),
                }
              : {}),
          },
        };
      }
      await expect(await recording(cells)).toMatchFileSnapshot(
        '../../../../test/expense-entry-readings/recordings/android-' +
          (edit ? 'edit' : 'new') +
          '.json',
      );
    },
  );
}

it('records Android Finish later through the phone (#1111)', async () => {
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
  const cells: Record<string, Reading> = {};
  for (const row of entries) {
    if (row.savedZeroPayer) {
      cells[row.id] = unsupportedEdit();
      continue;
    }
    const server = world();
    server.world.pages['/api/groups/' + groupId + '/drafts'] = [];
    server.reply('POST', '/api/groups/' + groupId + '/drafts', ({ body }) =>
      Response.json(
        {
          data: [
            {
              id: 'e00000000000000000000001',
              groupId,
              revision: 0,
              state: 'active',
              preparedBy: { kind: 'member' },
              changedBy: { kind: 'member' },
              missingFields: [],
              values: (body!.drafts as unknown[])[0],
              createdAt: day + 'T00:00:00.000Z',
              updatedAt: day + 'T00:00:00.000Z',
            },
          ],
        },
        { status: 201 },
      ),
    );
    const phone = testPhone(server, { now: Date.parse(day + 'T12:00:00Z') });
    const app = phone.open();
    await app.signIn('alex');
    await app.openExpense(groupId);
    await app.updateExpenseDraft(row);
    await app.keepExpenseAsSharedDraft();
    const sent = server.requests.find(
      (request) => request.method === 'POST' && request.path.endsWith('/drafts'),
    );
    const snapshot = app.getSnapshot();
    cells[row.id] = {
      result: sent
        ? { kind: 'draft', value: (sent.body!.drafts as unknown[])[0] }
        : {
            kind: 'refusal',
            issues: [{ field: '', message: snapshot.expense.message ?? 'No Draft sent' }],
          },
      shown: {
        screen: snapshot.screen,
        status: snapshot.expense.status,
        message: snapshot.expense.message,
      },
    };
    phone.dispose();
  }
  await expect(await recording(cells)).toMatchFileSnapshot(
    '../../../../test/expense-entry-readings/recordings/android-finish-later.json',
  );
});

it('records Android To review changes through its existing form conversion (#1111)', async () => {
  const cells: Record<string, Reading> = {};
  for (const row of entries) {
    if (row.savedZeroPayer) {
      cells[row.id] = unsupportedEdit();
      continue;
    }
    try {
      // A member edits the typed fields of an initially incomplete stored item.
      const value = reviewFormChange({}, row, row.currency);
      cells[row.id] = {
        result: { kind: 'draft', value },
        shown: await shown(reviewForm(value, row.currency)),
      };
    } catch (error) {
      cells[row.id] = { result: refusal(error) };
    }
  }
  await expect(await recording(cells)).toMatchFileSnapshot(
    '../../../../test/expense-entry-readings/recordings/android-review.json',
  );
});
