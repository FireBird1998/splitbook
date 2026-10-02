import { View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { readExpenseMoney } from '@splitbook/shared/expense-money-edit';
import { describeExpenseHistory } from '../data/expense-history';
import { storedExpenseMoney, type ExpenseRecord } from '../data/expense-record';
import { Copy, Label, Panel } from './primitives';
import { fonts, useTheme } from './theme';

/** Authoritative saved values, also used beside an unchanged draft during conflict review. */
export function ExpenseRecordView({
  record,
  title = 'Saved Expense',
  people,
  tags,
}: {
  record: ExpenseRecord;
  title?: string;
  /** The Group's current members and Tags, so history can name them. */
  people?: { id: string; name: string }[];
  tags?: { id: string; name: string }[];
}) {
  const theme = useTheme();
  const history = describeExpenseHistory(record, people, tags);
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
      <Copy>Revision {record.revision}</Copy>
      <Copy>Last updated {new Date(record.updatedAt).toLocaleString()}</Copy>
      <View style={{ gap: 12 }}>
        <Copy accessibilityRole="header" style={{ fontFamily: fonts.semibold }}>
          Edit history
        </Copy>
        {!history.length ? (
          <Copy>No recorded edits.</Copy>
        ) : (
          history.map((entry) => (
            <View key={entry.key} style={{ gap: 4 }}>
              <Copy style={{ fontFamily: fonts.semibold }}>{entry.summary}</Copy>
              {entry.changes.map((change, index) => (
                <Copy
                  key={`${change.label}:${index}`}
                  accessibilityLabel={
                    change.before && change.after
                      ? `${change.label} changed from ${change.before} to ${change.after}`
                      : undefined
                  }
                >
                  {change.label}
                  {change.before && change.after ? (
                    <>
                      {': '}
                      <Copy style={change.money?.before ? { fontFamily: fonts.mono } : undefined}>
                        {change.before}
                      </Copy>
                      {' → '}
                      <Copy style={change.money?.after ? { fontFamily: fonts.mono } : undefined}>
                        {change.after}
                      </Copy>
                    </>
                  ) : change.after ? (
                    `: ${change.after}`
                  ) : (
                    ' changed'
                  )}
                </Copy>
              ))}
              <Copy style={{ color: theme.textSecondary, fontSize: 13 }}>{entry.editedAt}</Copy>
            </View>
          ))
        )}
      </View>
    </Panel>
  );
}
