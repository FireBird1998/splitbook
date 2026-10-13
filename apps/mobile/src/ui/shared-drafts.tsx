import { Alert, TextInput, View } from 'react-native';
import {
  draftFields,
  draftEntryChanges,
  draftEntries,
} from '@splitbook/shared/persistent-draft-editor';
import type { MobileController } from '../data/mobile-controller';
import type { SharedDraftCollectionState } from '../data/shared-draft-collection';
import { Button, Copy } from './primitives';
import { useTheme } from './theme';

/** The existing incomplete Expense editor, reused inside To review until the guided review. */
export function SharedDraftEditor({
  client,
  state,
  offline,
}: {
  client: ReturnType<MobileController['draftCollection']>;
  state: SharedDraftCollectionState;
  offline: boolean;
}) {
  const theme = useTheme();
  const { editing, entries, choice, busy, pending, context } = state;
  if (!editing) return null;
  if (!context) return <Copy>Connect to load the people and Tags for this item.</Copy>;
  const disabled = busy || offline;
  const choices = {
    members: context.group.members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
    })),
    tags: context.tags
      .filter((tag) => !tag.isArchived && !tag.isDeleted)
      .map((tag) => ({ id: tag.id, name: tag.name })),
  };
  return (
    <View style={{ gap: 12 }}>
      <Copy accessibilityRole="header">Edit expense details</Copy>
      {draftFields(entries, choices).map((field) => (
        <View key={field.key} style={{ gap: 6 }}>
          <Copy>{field.label}</Copy>
          {field.options ? (
            <View style={{ gap: 6 }}>
              <Button
                secondary
                disabled={disabled}
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
                    disabled={disabled || option.disabled}
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
              editable={!disabled}
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
        label="Keep changes for later"
        disabled={disabled || pending}
        onPress={() => void client.keep()}
      />
      <Copy>Keeping these details does not change Balances.</Copy>
      <Button
        label="Close editor"
        secondary
        disabled={busy}
        onPress={() => {
          const initial = draftEntries(editing === 'new' ? undefined : editing.values);
          const changed = Object.keys({ ...initial, ...entries }).some(
            (key) => (initial[key] ?? '') !== (entries[key] ?? ''),
          );
          if (!changed || pending) return client.closeEditor();
          Alert.alert('Discard your changes?', 'The last kept details will stay in To review.', [
            { text: 'Keep editing', style: 'cancel' },
            { text: 'Discard changes', style: 'destructive', onPress: () => client.closeEditor() },
          ]);
        }}
      />
      {editing !== 'new' && (
        <Button
          label="Reload latest details"
          hint="Replaces your changes with the last kept details"
          secondary
          disabled={disabled || pending}
          onPress={() =>
            Alert.alert(
              'Replace your changes?',
              'Load the last kept details for this item. Your current changes will be replaced.',
              [
                { text: 'Keep editing', style: 'cancel' },
                { text: 'Reload latest details', onPress: () => void client.loadLatest() },
              ],
            )
          }
        />
      )}
    </View>
  );
}
