import { View } from 'react-native';
import {
  formatActivityHeadline,
  formatActivityDetail,
  formatActivityTimestamp,
} from '@splitbook/shared/activity-timeline';
import { formatCurrency } from '@splitbook/shared/currency';
import type { ActivityEvent, ActivityState } from '../data/activity';
import { Button, Copy, Label, Loading, Panel, Icon, type IconName } from './primitives';
import { fonts, useTheme } from './theme';

const events: Record<string, { label: string; icon: IconName }> = {
  expense_added: { label: 'Expense added', icon: 'receipt-outline' },
  expense_updated: { label: 'Expense updated', icon: 'create-outline' },
  expense_deleted: { label: 'Expense deleted', icon: 'trash-outline' },
  settlement_recorded: { label: 'Payment recorded', icon: 'checkmark-circle-outline' },
  member_joined: { label: 'Member joined', icon: 'person-add-outline' },
  member_left: { label: 'Member left', icon: 'person-remove-outline' },
  group_created: { label: 'Group created', icon: 'people-outline' },
  group_updated: { label: 'Group updated', icon: 'settings-outline' },
};
const fieldNames: Record<string, string> = {
  description: 'Description',
  amount: 'Amount',
  currency: 'Currency',
  date: 'Expense date',
  paidBy: 'Payers',
  splitBetween: 'Participant shares',
  splitMethod: 'Split method',
  notes: 'Notes',
  category: 'Category',
  tag: 'Tag',
  tagId: 'Tag reference',
  amountMinor: 'Amount in minor units',
  user: 'Member reference',
  percentage: 'Percentage',
  shares: 'Shares',
};
function snapshotValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not recorded';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(snapshotValue).join('\n');
  return Object.entries(value)
    .map(([key, entry]) => `${fieldNames[key] ?? key}: ${snapshotValue(entry)}`)
    .join(', ');
}
function EventSummary({ event }: { event: ActivityEvent }) {
  const theme = useTheme(),
    meta = event.metadata;
  const kind = events[event.type] ?? { label: 'Group event', icon: 'time-outline' };
  const detail = formatActivityDetail(event);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon
          name={kind.icon}
          color={event.type === 'settlement_recorded' ? theme.status.positive : theme.brand.main}
        />
        <Label>{kind.label.toUpperCase()}</Label>
      </View>
      <Copy style={{ fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28 }}>
        {formatActivityHeadline(event)}
      </Copy>
      {meta.amount !== undefined && meta.currency ? (
        <Copy style={{ fontFamily: fonts.mono }}>
          {formatCurrency(meta.amount, meta.currency)} {meta.currency}
        </Copy>
      ) : null}
      {event.type === 'settlement_recorded' && detail ? <Copy>{detail}</Copy> : null}
      <Copy style={{ color: theme.textSecondary }}>{formatActivityTimestamp(event)}</Copy>
    </View>
  );
}
export function ActivityScreen({
  state,
  onRefresh,
  onMore,
  onSelect,
  onClose,
}: {
  state: ActivityState;
  onRefresh: () => void;
  onMore: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const selected = state.selected;
  return (
    <View style={{ gap: 20 }}>
      <Label>YOUR SHARED LEDGER</Label>
      <Copy
        accessibilityRole="header"
        style={{ fontFamily: fonts.semibold, fontSize: 30, lineHeight: 38 }}
      >
        {selected ? 'Event details' : 'Activity'}
      </Copy>
      {state.message ? <Copy accessibilityRole="alert">{state.message}</Copy> : null}
      <Button label="Refresh Activity" onPress={onRefresh} disabled={state.status === 'loading'} />
      {state.status === 'loading' ? <Loading label="Refreshing Group Activity…" /> : null}
      {selected ? (
        <>
          <Panel>
            <EventSummary event={selected} />
            <Copy>
              Historical event snapshot. These details describe what was recorded then, not the
              current editable Expense.
            </Copy>
            <Copy>Actor: {selected.actor?.name || 'Former member'}</Copy>
            {selected.metadata.action ? <Copy>Action: {selected.metadata.action}</Copy> : null}
            {selected.metadata.expenseId ? (
              <Copy selectable>Expense reference: {selected.metadata.expenseId}</Copy>
            ) : null}
            {selected.metadata.settlementId ? (
              <Copy selectable>Payment reference: {selected.metadata.settlementId}</Copy>
            ) : null}
            {Object.entries(selected.metadata.changes ?? {}).map(([field, change]) => (
              <View key={field} style={{ gap: 6 }}>
                <Copy style={{ fontFamily: fonts.semibold }}>{fieldNames[field] ?? field}</Copy>
                <Copy>Before: {snapshotValue(change.old)}</Copy>
                <Copy>After: {snapshotValue(change.new)}</Copy>
              </View>
            ))}
            {selected.type === 'settlement_recorded' ? (
              <Copy>
                This records a payment already made. SplitBook did not transfer funds or confirm
                provider status.
              </Copy>
            ) : null}
          </Panel>
          {state.target.status === 'loading' ? (
            <Loading label="Checking current record access…" />
          ) : null}
          {['available', 'deleted', 'unavailable', 'error'].includes(state.target.status) ? (
            <Panel>
              <Label>CURRENT RECORD CHECK</Label>
              <Copy>
                {state.target.status === 'deleted'
                  ? 'This Expense is currently deleted. Its historical Activity remains available.'
                  : state.target.status === 'available'
                    ? 'This Expense currently exists. Its current values may differ from this event.'
                    : state.target.status === 'unavailable'
                      ? 'The linked Expense is unavailable. This does not change the historical event.'
                      : 'Could not check the current record. Its present state is unknown.'}
              </Copy>
              {state.target.description ? (
                <Copy>Current description: {state.target.description}</Copy>
              ) : null}
              {state.target.status === 'error' ? (
                <Button
                  label="Retry record check"
                  secondary
                  onPress={() => onSelect(selected._id)}
                />
              ) : null}
            </Panel>
          ) : null}
          {selected.type.startsWith('expense_') && !selected.metadata.expenseId ? (
            <Copy>No linked Expense reference was recorded for this historical event.</Copy>
          ) : null}
          <Button label="Back to Activity" secondary onPress={onClose} />
        </>
      ) : (
        <>
          <Copy>
            Who changed what, across this Group. Amounts belong to individual events and are not
            your current balance.
          </Copy>
          {state.status === 'ready' && state.events.length === 0 ? (
            <Panel>
              <Copy>No Activity is available yet.</Copy>
              <Copy>
                A missing event does not mean an Expense or payment failed. Refresh to check for
                recovered history.
              </Copy>
            </Panel>
          ) : null}
          {state.events.map((event) => (
            <Panel key={event._id}>
              <EventSummary event={event} />
              <Button
                label="View details"
                accessibilityLabel={`View event: ${formatActivityHeadline(event)}`}
                secondary
                disabled={state.status !== 'ready'}
                onPress={() => onSelect(event._id)}
              />
            </Panel>
          ))}
          {state.status === 'ready' &&
          state.pagination &&
          state.pagination.page < state.pagination.totalPages ? (
            <Button
              label={
                state.moreStatus === 'loading' ? 'Loading older Activity…' : 'Load older Activity'
              }
              disabled={state.moreStatus === 'loading'}
              secondary
              onPress={onMore}
            />
          ) : null}
        </>
      )}

      <Copy style={{ color: theme.textSecondary }}>
        History comes from the shared ledger. Refresh may reveal recovered events; it never records
        another payment.
      </Copy>
    </View>
  );
}
