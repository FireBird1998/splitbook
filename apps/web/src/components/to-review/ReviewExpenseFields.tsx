'use client';
import { useState } from 'react';
import { draftForExpenseEntry, fieldDraftEntryPolicy } from '@splitbook/shared/expense-entry-draft';
import {
  readExpenseEntry,
  formSummaryPolicy,
  type IncompleteExpenseEntry,
} from '@splitbook/shared/expense-entry';
import { normalizeExpenseMoney } from '@splitbook/shared/exact-money';
import {
  completeExpenseDraftSchema,
  withGroupCurrency,
  type ExpenseDraftValues,
} from '@splitbook/shared/validators/expense-draft';
import ExpenseFields from '@/components/expenses/ExpenseFields';
import type { DraftContext } from '@splitbook/shared/expense-entry-draft';

/** Picker defaults are a projection. Only an edited entry field becomes a Draft fact. */
export default function ReviewExpenseFields({
  entry,
  original,
  changes = {},
  context,
  onChange,
  listedTwice,
}: {
  entry: IncompleteExpenseEntry;
  original: ExpenseDraftValues;
  changes?: Partial<Record<keyof IncompleteExpenseEntry, boolean>>;
  context: DraftContext;
  onChange: (changes: Partial<IncompleteExpenseEntry>) => void;
  listedTwice?: readonly string[];
}) {
  const [multiple, setMultiple] = useState(false);
  const loneAmount = entry.payers[0]?.amount;
  const mismatched =
    entry.payers.length === 1 && Boolean(loneAmount) && loneAmount !== entry.amount;
  // Keep several payers open while the member clears an amount to retype it (#591).
  if (mismatched && !multiple) setMultiple(true);
  const multiPayer = multiple || mismatched || entry.multiPayer;
  const currentTag = changes.tagId ? undefined : original.tag;
  const shown = {
    ...entry,
    currency: entry.currency || context.currency || '',
    category: entry.category || 'other',
    tagId:
      entry.tagId || context.tags.find((tag) => tag.name === currentTag)?.id || currentTag || '',
    multiPayer,
  };
  function edit(change: Partial<IncompleteExpenseEntry>) {
    if (change.multiPayer !== undefined) setMultiple(change.multiPayer);
    // Expanding Who paid is an interaction, not a saved edit until a box changes.
    if (Object.keys(change).every((key) => key === 'multiPayer')) return;
    if (change.participantIds) {
      const remembered = { ...entry.splitValues };
      for (const id of change.participantIds)
        if (!Object.hasOwn(remembered, id)) remembered[id] = '';
      const selected = new Set(change.participantIds);
      change = {
        ...change,
        participantIds: Object.keys(remembered).filter((id) => selected.has(id)),
        splitValues: { ...remembered, ...change.splitValues },
      };
    }
    const nextMode = change.multiPayer ?? multiPayer;
    const payers = change.payers ?? entry.payers;
    onChange({
      ...change,
      ...(change.payers || change.amount !== undefined
        ? {
            multiPayer: nextMode,
            ...(!nextMode && (change.payers || payers.length === 1)
              ? { payers: payers.map((row) => ({ ...row, amount: change.amount ?? entry.amount })) }
              : {}),
          }
        : {}),
    });
  }
  const members = [...context.members];
  for (const id of [...entry.payers.map((row) => row.user), ...entry.participantIds])
    if (!members.some((member) => member.id === id)) members.push({ id, name: 'Former member' });
  let preview: ReturnType<typeof normalizeExpenseMoney> | undefined;
  try {
    const parsed = completeExpenseDraftSchema.safeParse(
      withGroupCurrency(
        draftForExpenseEntry(entry, fieldDraftEntryPolicy, { from: original, changed: changes }),
        context.currency,
      ),
    );
    if (parsed.success) preview = normalizeExpenseMoney(parsed.data);
  } catch {
    // An incomplete Draft remains editable; the review machine asks for the missing facts.
  }
  const reading = readExpenseEntry(shown, { kind: 'new' }, formSummaryPolicy);
  // To review uses the server's completeness check: a missing row must not become zero here.
  reading.split.shares = Object.fromEntries(
    preview?.splitBetween.map((row) => [row.user, row.amountMinor]) ?? [],
  );
  return (
    <ExpenseFields
      review
      listedTwice={listedTwice}
      entry={shown}
      reading={reading}
      editEntry={edit}
      isEditMode
      groupCurrency={context.currency}
      groupCategory={context.category}
      userId=""
      viewerId={context.viewerId}
      members={members.map((member) => ({ user: { _id: member.id, name: member.name } }))}
      groupTags={context.tags.map((tag) => ({ _id: tag.id, name: tag.name, isArchived: false }))}
      currentTag={currentTag}
      currentTagId={changes.tagId ? entry.tagId : original.tagId}
      chooseSplitMethod={(splitMethod) =>
        onChange({
          splitMethod,
          splitValues: Object.fromEntries(Object.keys(entry.splitValues).map((id) => [id, ''])),
        })
      }
    />
  );
}
