import { formatCurrency } from '@splitbook/shared/currency';
import { useEffect, useMemo } from 'react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';
import { Alert, Modal, ScrollView, TextInput, View } from 'react-native';
import {
  draftEntries,
  draftFields,
  draftEntryChanges,
} from '@splitbook/shared/persistent-draft-editor';
import type { MobileController } from '../data/mobile-controller';
import type { MobileGroup, MobileSnapshot } from '../data/types';
import { Button, Copy } from './primitives';
import { useTheme } from './theme';

export function SharedDrafts({
  controller,
  group,
  accountId,
  onClose,
}: {
  controller: Pick<MobileController, 'draftCollection' | 'subscribe'> & {
    getSnapshot(): Pick<MobileSnapshot, 'sharedDraftCollection'>;
  };
  group: MobileGroup;
  accountId: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const client = useMemo(
    () => controller.draftCollection(group.id),
    [controller, group.id, accountId],
  );
  const state = useSyncExternalStoreWithSelector(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
    (snapshot) => snapshot.sharedDraftCollection,
  );
  const {
    choice,
    rows,
    selected,
    reviews,
    ack,
    outcomes,
    outcomeNames,
    editing,
    entries,
    pending,
    busy,
    message,
  } = state;
  useEffect(() => client.open(), [client]);
  const context = {
    members: (state.context?.group ?? group).members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
    })),
    tags: (state.context?.tags ?? [])
      .filter((tag) => !tag.isArchived && !tag.isDeleted)
      .map((tag) => ({ id: tag.id, name: tag.name })),
  };
  return (
    <Modal
      visible
      onRequestClose={() => {
        if (!busy) onClose();
      }}
      animationType="slide"
    >
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ padding: 24, paddingTop: 48, gap: 16, backgroundColor: theme.bg }}
      >
        <Copy accessibilityRole="header">Your private Drafts</Copy>
        <Copy>
          Online only. Drafts do not change Balances. Saving happens only after your review in
          SplitBook.
        </Copy>
        <Button label="Close Drafts" secondary onPress={onClose} disabled={busy} />
        {!!message && <Copy accessibilityRole="alert">{message}</Copy>}
        {pending && (
          <>
            <Copy>A previous request is not confirmed. Retry it before starting another.</Copy>
            <Button
              label="Retry original request"
              disabled={busy}
              onPress={() => void client.retry()}
            />
          </>
        )}
        <Button
          label="Reload Drafts"
          secondary
          disabled={busy}
          onPress={() => void client.refresh()}
        />
        <Button label="New Draft" disabled={busy || pending} onPress={() => client.newDraft()} />
        {editing && (
          <View style={{ gap: 12 }}>
            <Copy accessibilityRole="header">
              {editing === 'new' ? 'Keep an incomplete Expense' : 'Edit Draft'}
            </Copy>
            {draftFields(entries, context).map((field) => (
              <View key={field.key} style={{ gap: 6 }}>
                <Copy>{field.label}</Copy>
                {field.options ? (
                  <View style={{ gap: 6 }}>
                    <Button
                      secondary
                      disabled={busy}
                      label={
                        field.options.find(
                          (option) => option.value === (field.value ?? entries[field.key]),
                        )?.label ?? 'Not specified'
                      }
                      onPress={() => client.choose(choice === field.key ? null : field.key)}
                    />
                    {choice === field.key &&
                      [{ value: '', label: 'Not specified' }, ...field.options].map((option) => (
                        <Button
                          key={option.value}
                          label={option.label}
                          secondary
                          disabled={busy || option.disabled}
                          onPress={() => {
                            for (const [key, value] of Object.entries(
                              draftEntryChanges(field.key, option.value),
                            ))
                              client.enter(key, value);
                          }}
                        />
                      ))}
                  </View>
                ) : (
                  <TextInput
                    accessibilityLabel={field.label}
                    value={entries[field.key] ?? ''}
                    editable={!busy}
                    keyboardType={field.numeric ? 'decimal-pad' : 'default'}
                    autoCapitalize="none"
                    onChangeText={(value) => client.enter(field.key, value)}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.textSecondary,
                      borderRadius: 8,
                      padding: 12,
                      color: theme.text,
                    }}
                  />
                )}
              </View>
            ))}
            <Button
              label="Keep as Draft"
              disabled={busy || pending}
              onPress={() => void client.keep()}
            />
            <Button
              label="Close editor"
              secondary
              disabled={busy}
              onPress={() => client.closeEditor()}
            />
            {editing !== 'new' && (
              <Button
                label="Load latest and replace unsent entries"
                secondary
                disabled={busy}
                onPress={() => void client.loadLatest()}
              />
            )}
          </View>
        )}
        {!rows.length && <Copy>No active Drafts.</Copy>}
        {rows.map((row) => (
          <View
            key={row.id}
            style={{
              gap: 8,
              borderWidth: 1,
              borderColor: theme.textSecondary,
              padding: 12,
              borderRadius: 12,
            }}
          >
            <Copy>
              {row.values?.description || 'Description missing'} ·{' '}
              {row.values?.amount ?? 'Amount missing'} {row.values?.currency ?? ''} ·{' '}
              {row.values?.date ?? 'Date missing'}
            </Copy>
            <Button
              label={selected.includes(row.id) ? 'Deselect Draft' : 'Select Draft'}
              secondary
              disabled={busy}
              onPress={() => client.select(row.id)}
            />
            <Button label="Edit Draft" secondary disabled={busy} onPress={() => client.edit(row)} />
            <Button
              label="Discard permanently"
              secondary
              disabled={busy}
              onPress={() =>
                Alert.alert('Permanently discard Draft?', 'Its content cannot be recovered.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Discard',
                    style: 'destructive',
                    onPress: () => void client.discard(row),
                  },
                ])
              }
            />
          </View>
        ))}
        <Button
          label="Review selected Drafts"
          disabled={busy || pending || !selected.length}
          onPress={() => void client.review()}
        />
        {reviews.map((review) => (
          <View key={review.draft.id} style={{ gap: 8 }}>
            <Copy accessibilityRole="header">
              Review: {review.draft.values?.description || 'Incomplete Draft'}
            </Copy>
            {draftFields(draftEntries(review.draft.values), context).map((field) => {
              const value = field.value ?? draftEntries(review.draft.values)[field.key];
              return value ? (
                <Copy key={field.key}>
                  {field.label}:{' '}
                  {field.options?.find((option) => option.value === value)?.label ?? value}
                </Copy>
              ) : null;
            })}
            {review.allocation && (
              <View>
                <Copy>Exact allocation</Copy>
                {review.allocation.paidBy.map((row) => (
                  <Copy key={`paid:${row.user}`}>
                    {context.members.find((member) => member.id === row.user)?.name ?? row.user}{' '}
                    paid {formatCurrency(row.amount, review.allocation!.currency)}
                  </Copy>
                ))}
                {review.allocation.splitBetween.map((row) => (
                  <Copy key={`share:${row.user}`}>
                    {context.members.find((member) => member.id === row.user)?.name ?? row.user}{' '}
                    shares {formatCurrency(row.amount, review.allocation!.currency)}
                  </Copy>
                ))}
              </View>
            )}
            {review.problems.map((problem, i) => (
              <Copy key={i}>{problem}</Copy>
            ))}
            {!!review.duplicates.length && (
              <>
                <Copy>
                  Possible duplicates (matching description, amount, currency and UTC date):{' '}
                  {review.duplicates.map((item) => `${item.kind}: ${item.description}`).join(', ')}
                </Copy>
                <Button
                  secondary
                  label={
                    ack.includes(review.draft.id)
                      ? 'Repetition acknowledged'
                      : 'I reviewed the matches; save a separate Expense'
                  }
                  onPress={() => client.acknowledge(review.draft.id)}
                  disabled={busy}
                />
              </>
            )}
          </View>
        ))}
        {!!reviews.length && (
          <Button
            label="Save reviewed Drafts"
            disabled={busy || pending}
            onPress={() => void client.save()}
          />
        )}
        {outcomes.map((outcome) => (
          <Copy key={outcome.id}>
            {outcomeNames[outcome.id] || `Draft ${outcome.id}`}:{' '}
            {outcome.status === 'saved' ? 'Expense saved' : outcome.message}
          </Copy>
        ))}
      </ScrollView>
    </Modal>
  );
}
