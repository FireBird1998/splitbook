import { Pressable, View } from 'react-native';
import { getCurrencyPrecision } from '@splitbook/shared/currency';
import type { ExpenseCurrencyChoice } from '@splitbook/shared/group-currencies';
import { Banner, BottomSheet, CompactText, radius, touch, useTap } from './compact';
import { fonts, useTheme } from './theme';

/** "Your latest Expense here · whole amounts only": why a currency is offered, and its rule. */
function choiceNotes(choice: ExpenseCurrencyChoice) {
  return [choice.note, getCurrencyPrecision(choice.code) === 0 ? 'whole amounts only' : null]
    .filter((note): note is string => !!note)
    .map((note, index) => (index === 0 ? note : note.charAt(0).toLowerCase() + note.slice(1)));
}

/** "JPY, Japanese Yen, your latest Expense here, whole amounts only", as TalkBack reads a row. */
function choiceLabel(choice: ExpenseCurrencyChoice) {
  return [
    choice.code,
    choice.name,
    ...choiceNotes(choice).map((note) => note.charAt(0).toLowerCase() + note.slice(1)),
  ].join(', ');
}

/**
 * Choosing an Expense's currency (#720, board "Pick the currency"): the Group's currencies as
 * radios, the member's latest Expense's first, then the main currency, then the others, as on
 * the web. Choosing one closes the sheet and keeps the number typed; nothing is converted.
 * Offline, the choices are the ones saved on this phone, and picking one still works.
 */
export function CurrencySheet({
  visible,
  groupName,
  choices,
  currency,
  locked,
  offline,
  onChoose,
  onDone,
}: {
  visible: boolean;
  groupName: string;
  /** From `expenseCurrencyChoices`: the Group's currencies, and an edited Expense's own. */
  choices: readonly ExpenseCurrencyChoice[];
  currency: string;
  locked: boolean;
  offline: boolean;
  onChoose: (currency: string) => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  // A drag that starts on a currency never picks it (#665).
  const tap = useTap();
  const listed = choices.filter((choice) => choice.note !== 'This Expense’s currency').length;
  return (
    <BottomSheet
      visible={visible}
      title="Currency"
      subtitle={`${groupName} · ${listed} ${listed === 1 ? 'currency' : 'currencies'}`}
      onDone={onDone}
      footer={
        <CompactText variant="small" tone="secondary">
          Changing the currency keeps the number you typed. Nothing is converted.
        </CompactText>
      }
    >
      {offline ? (
        <Banner
          tone="offline"
          message="You’re offline. These are the currencies saved on this phone, so picking one still works."
        />
      ) : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Currency for this Expense"
        style={{ marginHorizontal: -20, gap: 4 }}
      >
        {choices.map((choice) => {
          const selected = choice.code === currency;
          const notes = choiceNotes(choice);
          return (
            <Pressable
              key={choice.code}
              accessibilityRole="radio"
              accessibilityLabel={choiceLabel(choice)}
              accessibilityState={{ checked: selected, disabled: locked }}
              disabled={locked}
              {...tap.on(() => !locked && onChoose(choice.code))}
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
                <CompactText style={{ fontFamily: fonts.mono, fontSize: 14 }}>
                  {choice.code}
                </CompactText>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <CompactText weight="semibold">{choice.name}</CompactText>
                {notes.length ? (
                  <CompactText variant="small" tone="secondary">
                    {notes.join(' · ')}
                  </CompactText>
                ) : null}
              </View>
              {selected ? (
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    borderWidth: 2,
                    borderColor: theme.brand.main,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: theme.brand.main,
                    }}
                  />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}
