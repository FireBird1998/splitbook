import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { CURRENCY_CODES } from '@splitbook/shared/currency';
import { MAX_EXTRA_CURRENCIES } from '@splitbook/shared/group-currencies';
import { addableCurrencies, alreadyListedNote } from '@splitbook/shared/group-currency-settings';
import { Banner, BottomSheet, CompactButton, CompactText, radius, touch, useTap } from './compact';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';

/**
 * Adding a currency to a Group (#722, board "Add a currency"), as any member may on the web: a
 * search of the supported currencies the Group doesn't list yet, then Add. Nothing is converted;
 * everyone in the Group can then use it.
 */
export function AddCurrencySheet({
  visible,
  groupName,
  listed,
  extraCount,
  adding,
  message,
  onAdd,
  onCancel,
}: {
  visible: boolean;
  groupName: string;
  /** The Group's currencies, main first: they aren't offered again. */
  listed: readonly string[];
  extraCount: number;
  /** The add is being sent: nothing closes the sheet meanwhile. */
  adding: boolean;
  /** Why the Group refused the last one, in the server's words. */
  message: string | null;
  onAdd: (currency: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  // A drag that starts on a currency never picks it (#665).
  const tap = useTap();
  const found = addableCurrencies(listed, query);
  const picked = chosen && found.some(({ code }) => code === chosen) ? chosen : null;
  return (
    <BottomSheet
      visible={visible}
      title="Add a currency"
      subtitle={`${groupName} · ${extraCount} of ${MAX_EXTRA_CURRENCIES} extra currencies`}
      onDone={onCancel}
      doneLabel="Cancel"
      dismissLabel="Close Add a currency"
      dismissible={!adding}
      footer={
        <View style={{ gap: 6 }}>
          <CompactButton
            label={picked ? `Add ${picked}` : 'Add'}
            disabled={!picked}
            busy={adding && picked ? `Adding ${picked}…` : undefined}
            onPress={() => picked && onAdd(picked)}
          />
          {picked ? (
            <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              Everyone in {groupName} can then use {picked}.
            </CompactText>
          ) : null}
        </View>
      }
    >
      {message ? <Banner tone="error" message={message} /> : null}
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
          maxLength={40}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          placeholder={`Search ${CURRENCY_CODES.length - listed.length} currencies`}
          placeholderTextColor={theme.textMuted}
          selectionColor={theme.brand.main}
          accessibilityLabel="Search currencies"
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
      {found.length ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Currencies you can add"
          style={{ marginHorizontal: -20, gap: 4 }}
        >
          {found.map(({ code, name }) => {
            const selected = code === picked;
            return (
              <Pressable
                key={code}
                accessibilityRole="radio"
                accessibilityLabel={`${code}, ${name}`}
                accessibilityState={{ checked: selected, disabled: adding }}
                disabled={adding}
                {...tap.on(() => !adding && setChosen(code))}
                style={({ pressed }) => ({
                  minHeight: touch.min,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingHorizontal: 20,
                  paddingVertical: 6,
                  backgroundColor: pressed && !tap.dragged ? theme.surfaceMuted : undefined,
                })}
              >
                <View
                  style={{
                    minWidth: 48,
                    paddingVertical: 4,
                    paddingHorizontal: 8,
                    borderRadius: radius.tile,
                    backgroundColor: theme.surfaceMuted,
                    alignItems: 'center',
                  }}
                >
                  <CompactText style={{ fontFamily: fonts.mono, fontSize: 14 }}>{code}</CompactText>
                </View>
                <CompactText weight="semibold" style={{ flex: 1 }}>
                  {name}
                </CompactText>
                {selected ? <Icon name="checkmark" size={20} color={theme.brand.main} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <CompactText tone="secondary">
          No currency you can add matches “{query.trim()}”.
        </CompactText>
      )}
      <CompactText variant="caption" tone="secondary">
        {alreadyListedNote(listed)}
      </CompactText>
    </BottomSheet>
  );
}
