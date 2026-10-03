import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { expenseTagError, type ExpenseEditor } from '../data/expense-draft';
import { FieldError } from './group-workflows';
import { Icon } from './primitives';
import { BottomSheet, CompactText, FieldMarker, radius, touch } from './compact';
import { fonts, useTheme } from './theme';

/**
 * What to say when the draft's Tag is one the Group no longer offers. A Tag the member chose is
 * a correction, shown at once since it isn't a typing slip; one the saved Expense already has
 * is kept. Nothing is swapped in for either.
 */
export function inactiveTagReport({ draft, context, attempt }: ExpenseEditor): {
  error?: string;
  notice?: string;
} {
  const tag = context?.tags.find((item) => item.id === draft?.tagId);
  if (!draft?.tagId || !context || (tag && !tag.isArchived && !tag.isDeleted)) return {};
  if (draft.original && draft.tagId === (draft.original.tagId ?? ''))
    return {
      notice: `“${tag?.name ?? draft.original.tag}” is no longer active in this Group. This Expense keeps it.`,
    };
  if (attempt)
    return {
      notice: `Submitted Tag: ${tag?.name ?? 'unavailable'}. Recovery keeps the original Tag identity.`,
    };
  return { error: expenseTagError(draft, context) };
}

/**
 * Choosing a Tag: the Group's active Tags as radios, with search. Choosing one closes the sheet;
 * Done keeps the current Tag.
 */
export function TagSheet({
  visible,
  tags,
  tagId,
  error,
  notice,
  locked,
  onChoose,
  onDone,
}: {
  visible: boolean;
  /** The Group's active Tags, or null when they can't be checked offline. */
  tags: { id: string; name: string }[] | null;
  tagId: string;
  /** Why the draft's Tag isn't listed, from `inactiveTagReport`. */
  error?: string;
  notice?: string;
  locked: boolean;
  onChoose: (tagId: string) => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);
  const search = query.trim().toLocaleLowerCase();
  const shown = tags?.filter((tag) => tag.name.toLocaleLowerCase().includes(search)) ?? [];
  return (
    <BottomSheet
      visible={visible}
      title="Tag"
      titleAccessory={<FieldMarker kind="required" />}
      onDone={onDone}
      footer={
        tags?.length ? (
          <CompactText variant="small" tone="secondary">
            Only this Group’s active Tags are listed. Manage Tags on the web.
          </CompactText>
        ) : undefined
      }
    >
      <FieldError message={error} />
      {notice ? (
        <CompactText variant="small" tone="warning">
          {notice}
        </CompactText>
      ) : null}
      {!tags ? (
        <CompactText tone="secondary">Connect to see this Group’s Tags.</CompactText>
      ) : !tags.length ? (
        <CompactText tone="secondary">
          This Group has no active Tags. Add one on the web, then reopen this draft.
        </CompactText>
      ) : (
        <>
          <View
            style={{
              minHeight: touch.min,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 14,
              borderRadius: radius.tile,
              backgroundColor: theme.surfaceMuted,
            }}
          >
            <Icon name="search-outline" size={20} color={theme.textSecondary} />
            <TextInput
              value={query}
              maxLength={50}
              autoCorrect={false}
              returnKeyType="search"
              placeholder="Search Tags"
              placeholderTextColor={theme.textMuted}
              selectionColor={theme.brand.main}
              accessibilityLabel="Search Tags"
              onChangeText={setQuery}
              style={{
                flex: 1,
                minHeight: touch.min,
                padding: 0,
                color: theme.text,
                fontFamily: fonts.regular,
                fontSize: 15,
              }}
            />
          </View>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Tag"
            style={{ marginHorizontal: -20, gap: 4 }}
          >
            {shown.map((item) => {
              const selected = item.id === tagId;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityLabel={`Tag: ${item.name}`}
                  accessibilityState={{ checked: selected, disabled: locked }}
                  disabled={locked}
                  onPress={() => !locked && onChoose(item.id)}
                  style={({ pressed }) => ({
                    minHeight: touch.min,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingHorizontal: 20,
                    backgroundColor: pressed ? theme.surfaceMuted : undefined,
                  })}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      borderWidth: 2,
                      borderColor: selected ? theme.brand.main : theme.borderStrong,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {selected ? (
                      <View
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 6,
                          backgroundColor: theme.brand.main,
                        }}
                      />
                    ) : null}
                  </View>
                  <CompactText weight={selected ? 'semibold' : 'regular'} style={{ flex: 1 }}>
                    {item.name}
                  </CompactText>
                </Pressable>
              );
            })}
          </View>
          {!shown.length ? (
            <CompactText tone="secondary">No Tags match “{query.trim()}”.</CompactText>
          ) : null}
        </>
      )}
    </BottomSheet>
  );
}
