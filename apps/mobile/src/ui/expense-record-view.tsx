import { View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { readExpenseMoney } from '@splitbook/shared/expense-money-edit';
import { storedExpenseMoney, type ExpenseRecord } from '../data/expense-record';
import { Copy, Label, Panel } from './primitives';
import { fonts } from './theme';

/** Authoritative saved values, also used beside an unchanged draft during conflict review. */
export function ExpenseRecordView({
  record,
  title = 'Saved Expense',
  history = true,
}: {
  record: ExpenseRecord;
  title?: string;
  history?: boolean;
}) {
  const money = readExpenseMoney(storedExpenseMoney(record));
  const amount = (value: number) => formatCurrency(value, record.currency);
  const name = (id: string) =>
    [...record.paidBy, ...record.splitBetween].find((row) => row.user === id)?.name ??
    'Former member';
  return (
    <Panel>
      <Label>{title}</Label>
      <Copy
        accessibilityRole="header"
        style={{ fontFamily: fonts.semibold, fontSize: 24, lineHeight: 32 }}
      >
        {record.description}
      </Copy>
      <Copy style={{ fontFamily: fonts.mono }}>
        {amount(money.amount)} · {record.currency}
      </Copy>
      <Copy>
        {new Date(record.date).toLocaleDateString()} · {record.category}
      </Copy>
      <Copy>Tag: {record.tag || 'Historical Tag'}</Copy>
      {record.notes ? <Copy>Notes: {record.notes}</Copy> : null}
      {record.isDeleted ? <Copy accessibilityRole="alert">This Expense is deleted.</Copy> : null}
      <Copy style={{ fontFamily: fonts.semibold }}>Paid by</Copy>
      {money.paidBy.map((row) => (
        <Copy key={row.user}>
          {name(row.user)} · {amount(row.amount)}
        </Copy>
      ))}
      <Copy style={{ fontFamily: fonts.semibold }}>Allocated · {record.splitMethod}</Copy>
      {money.splitBetween.map((row) => (
        <Copy key={row.user}>
          {name(row.user)} · {amount(row.amount)}
          {row.percentage !== undefined ? ` · ${row.percentage}%` : ''}
          {row.shares !== undefined ? ` · ${row.shares} shares` : ''}
        </Copy>
      ))}
      <Copy>
        Created {new Date(record.createdAt).toLocaleString()}
        {record.createdBy
          ? ` by ${typeof record.createdBy === 'object' ? (record.createdBy.name ?? 'Former member') : name(record.createdBy)}`
          : ''}
      </Copy>
      {record.predefinedItem ? <Copy>Item: {record.predefinedItem}</Copy> : null}
      {record.receiptUrl ? <Copy>Receipt: {record.receiptUrl}</Copy> : null}
      {record.recurringExpense ? (
        <Copy>Recurring Expense{record.period ? ` · ${record.period}` : ''}</Copy>
      ) : null}
      {record.deletedAt ? <Copy>Deleted {new Date(record.deletedAt).toLocaleString()}</Copy> : null}
      <Copy>Last updated {new Date(record.updatedAt).toLocaleString()}</Copy>
      {history ? (
        <View style={{ gap: 12 }}>
          <Copy style={{ fontFamily: fonts.semibold }}>Edit history</Copy>
          {!record.editHistory.length ? (
            <Copy>No recorded edits.</Copy>
          ) : (
            record.editHistory.map((entry, index) => (
              <View key={`${entry.editedAt}:${index}`} style={{ gap: 6 }}>
                <Copy>
                  {typeof entry.editedBy === 'object' && entry.editedBy
                    ? (entry.editedBy.name ?? 'Former member')
                    : 'Member'}{' '}
                  · {new Date(entry.editedAt).toLocaleString()}
                </Copy>
                {Object.entries(entry.changes).map(([field, change]) => (
                  <Copy key={field}>
                    {field}: {JSON.stringify(change.old) ?? '—'} →{' '}
                    {JSON.stringify(change.new) ?? '—'}
                  </Copy>
                ))}
              </View>
            ))
          )}
        </View>
      ) : null}
    </Panel>
  );
}
