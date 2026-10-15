'use client';
import { useState } from 'react';
import { draftValues } from '@splitbook/shared/persistent-draft-editor';
import { normalizeExpenseMoney } from '@splitbook/shared/exact-money';
import { completeExpenseDraftSchema } from '@splitbook/shared/validators/expense-draft';
import { formatCurrency } from '@splitbook/shared/currency';
import ExpenseFields from '@/components/expenses/ExpenseFields';
import type { ExpenseDraftValues } from '@splitbook/shared/expense-draft';
import type { DraftContext, DraftEntries } from '@splitbook/shared/persistent-draft-editor';

/** Adapt only changed fields: opening a partial item must never invent missing facts. */
export default function ReviewExpenseFields({
  entries,
  context,
  onChange,
}: {
  entries: DraftEntries;
  context: DraftContext;
  onChange: (changes: DraftEntries) => void;
}) {
  const selected = (kind: string) =>
    Object.keys(entries)
      .filter(
        (key) =>
          key.startsWith(`${kind}.`) && key.split('.').length === 2 && entries[key] === 'yes',
      )
      .map((key) => key.split('.')[1]);
  const payerIds = selected('paidBy');
  const [multiple, setMultiple] = useState(false);
  const multiPayerMode =
    multiple ||
    payerIds.length > 1 ||
    (payerIds.length === 1 && entries[`paidBy.${payerIds[0]}.amount`] !== entries.amount);
  const parts = (part: string) =>
    Object.fromEntries(
      selected('splitBetween').map((id) => [id, entries[`splitBetween.${id}.${part}`] ?? '']),
    );
  const values = {
    description: entries.description ?? '',
    amount: entries.amount ?? '',
    currency: entries.currency ?? '',
    category: entries.category ?? '',
    date: entries.date ?? '',
    tag:
      entries.tagId ||
      context.tags.find((tag) => tag.name === entries.tag)?.id ||
      entries.tag ||
      '',
    notes: entries.notes ?? '',
    splitMethod: (entries.splitMethod ?? '') as ExpenseDraftValues['splitMethod'] | '',
    selectedMembers: selected('splitBetween'),
    payers: payerIds.map((user) => ({ user, amount: entries[`paidBy.${user}.amount`] ?? '' })),
    multiPayerMode,
    customAmounts: parts('amount'),
    customPercentages: parts('percentage'),
    customShares: parts('shares'),
  };
  function edit(change: Partial<ExpenseDraftValues>) {
    const patch: DraftEntries = {};
    for (const key of ['description', 'amount', 'currency', 'category', 'date', 'notes'] as const)
      if (change[key] !== undefined) patch[key] = change[key];
    if (change.tag !== undefined) {
      patch.tagId = change.tag;
      patch.tag = '';
    }
    if (change.multiPayerMode !== undefined) setMultiple(change.multiPayerMode);
    const multi = change.multiPayerMode ?? multiPayerMode;
    if (change.payers || (change.amount !== undefined && !multi && payerIds.length === 1)) {
      for (const key of Object.keys(entries)) if (key.startsWith('paidBy.')) patch[key] = '';
      for (const payer of change.payers ?? values.payers) {
        if (!payer.user) continue;
        patch[`paidBy.${payer.user}`] = 'yes';
        patch[`paidBy.${payer.user}.amount`] = multi
          ? payer.amount
          : (change.amount ?? values.amount);
      }
    }
    if (change.selectedMembers) {
      for (const id of values.selectedMembers) patch[`splitBetween.${id}`] = '';
      for (const id of change.selectedMembers) patch[`splitBetween.${id}`] = 'yes';
    }
    for (const [field, part] of [
      ['customAmounts', 'amount'],
      ['customPercentages', 'percentage'],
      ['customShares', 'shares'],
    ] as const)
      if (change[field])
        for (const [id, value] of Object.entries(change[field]))
          patch[`splitBetween.${id}.${part}`] = value;
    if (Object.keys(patch).length) onChange(patch);
  }
  // Retain removed identities visibly until the member replaces them.
  const members = [...context.members];
  for (const id of [...payerIds, ...values.selectedMembers])
    if (!members.some((member) => member.id === id)) members.push({ id, name: 'Former member' });
  let preview: ReturnType<typeof normalizeExpenseMoney> | undefined;
  try {
    const parsed = completeExpenseDraftSchema.safeParse(draftValues(entries));
    if (parsed.success) preview = normalizeExpenseMoney(parsed.data);
  } catch {
    // Incomplete typing is expected. The shared form still shows its totals and missing facts.
  }
  return (
    <ExpenseFields
      review
      values={values}
      edit={edit}
      isEditMode
      userId=""
      members={members.map((member) => ({ user: { _id: member.id, name: member.name } }))}
      groupTags={context.tags.map((tag) => ({ _id: tag.id, name: tag.name, isArchived: false }))}
      currentTag={entries.tag}
      currentTagId={entries.tagId}
      previewAmount={(id) => {
        const row = preview?.splitBetween.find((row) => row.user === id);
        return row ? formatCurrency(row.amount, values.currency) : '—';
      }}
      chooseSplitMethod={(method) => {
        const patch: DraftEntries = { splitMethod: method };
        for (const key of Object.keys(entries))
          if (key.startsWith('splitBetween.') && key.split('.').length === 3) patch[key] = '';
        onChange(patch);
      }}
    />
  );
}
