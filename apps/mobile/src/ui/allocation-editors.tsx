import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ExpenseDraft } from '../data/expense-draft';
import { acceptsNumericText } from '../data/field-feedback';
import { Field } from './group-workflows';
import { Button, Copy } from './primitives';
import { fonts, useTheme } from './theme';

export const splitMethods = [
  { id: 'equal', label: 'Equal', hint: 'Everyone has an equal share.' },
  { id: 'unequal', label: 'Unequal', hint: 'Enter each person’s amount in the Group currency.' },
  { id: 'percentage', label: 'Percentage', hint: 'Enter percentages that add up to 100.' },
  {
    id: 'shares',
    label: 'Shares',
    hint: 'Enter whole-number weights. For example, 2 shares and 1 share split the cost 2:1.',
  },
  { id: 'exact', label: 'Exact', hint: 'Enter exact amounts that add up to the Expense total.' },
] as const;

/**
 * The full-screen split editor, opened from the Split tile until the Split sheet (#123) replaces
 * it; Paid by opens the Who paid sheet. Done and Android Back keep entries.
 */
export function AllocationEditor({
  editor,
  draft,
  members,
  locked,
  persistence,
  allocationError,
  onChange,
  onClose,
}: {
  editor: 'payers' | 'split' | null;
  draft: ExpenseDraft;
  members: { id: string; name: string }[];
  locked: boolean;
  persistence: 'saved' | 'saving' | 'error';
  allocationError: string;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const method = splitMethods.find((item) => item.id === draft.splitMethod)!;
  const valueLabel =
    draft.splitMethod === 'percentage'
      ? 'Percent'
      : draft.splitMethod === 'shares'
        ? 'Shares'
        : `Amount (${draft.currency})`;
  const choice = (
    key: string,
    label: string,
    selected: boolean,
    onPress: () => void,
    radio = false,
  ) => (
    <Pressable
      key={key}
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={{
        minHeight: 48,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: selected ? theme.brand.main : theme.border,
        backgroundColor: selected ? theme.brand.bg : theme.surface,
      }}
    >
      <Copy>
        {selected ? '✓ ' : ''}
        {label}
      </Copy>
    </Pressable>
  );
  return (
    <Modal visible={editor === 'split'} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
          <View style={{ padding: 20, gap: 12 }}>
            <Copy
              accessibilityRole="header"
              style={{ fontFamily: fonts.semibold, fontSize: 26, lineHeight: 32 }}
            >
              Choose the split
            </Copy>
            <Button label="Done" onPress={onClose} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 20, gap: 16 }}
          >
            {editor === 'split' && (
              <>
                <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
                  {splitMethods.map((item) =>
                    choice(
                      item.id,
                      item.label,
                      draft.splitMethod === item.id,
                      () => onChange({ splitMethod: item.id }),
                      true,
                    ),
                  )}
                </View>
                <Copy>{method.hint}</Copy>
                <Copy style={{ color: theme.textSecondary }}>
                  Changing method clears the previous split values. Other draft entries stay saved.
                </Copy>
                {members.map((member) => (
                  <View key={member.id} style={{ gap: 8 }}>
                    {choice(
                      member.id,
                      `Include ${member.name}`,
                      draft.participantIds.includes(member.id),
                      () =>
                        onChange({
                          participantIds: draft.participantIds.includes(member.id)
                            ? draft.participantIds.filter((id) => id !== member.id)
                            : [...draft.participantIds, member.id],
                        }),
                    )}
                    {draft.splitMethod !== 'equal' && draft.participantIds.includes(member.id) && (
                      <Field
                        label={`${valueLabel} for ${member.name}`}
                        value={draft.splitValues[member.id] ?? ''}
                        hint="Use 0 for no share."
                        keyboardType={draft.splitMethod === 'shares' ? 'number-pad' : 'decimal-pad'}
                        maxLength={40}
                        editable={!locked}
                        onChangeText={(value) => {
                          const current = draft.splitValues[member.id] ?? '';
                          if (acceptsNumericText(value, current))
                            onChange({ splitValues: { ...draft.splitValues, [member.id]: value } });
                        }}
                      />
                    )}
                  </View>
                ))}
                {draft.participantIds.some((id) => !members.some((member) => member.id === id)) && (
                  <Button
                    label="Remove unavailable participants"
                    secondary
                    disabled={locked}
                    onPress={() =>
                      onChange({
                        participantIds: draft.participantIds.filter((id) =>
                          members.some((member) => member.id === id),
                        ),
                      })
                    }
                  />
                )}
              </>
            )}
            {allocationError && draft.amount ? (
              <Copy accessibilityRole="alert">{allocationError}</Copy>
            ) : null}
            <Copy>
              {persistence === 'saving'
                ? 'Saving draft…'
                : persistence === 'error'
                  ? 'Could not save these entries on this device. Close this editor and retry saving the draft.'
                  : 'Entries are saved with your draft. Done or Android Back keeps them.'}
            </Copy>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
