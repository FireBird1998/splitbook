import { Pressable, View } from 'react-native';
import { CompactText, Money, hairSpace, useTap, type TextTone } from './compact';
import { fonts, useTheme } from './theme';

/** One currency a switch offers: its code, a figure in it, and how a screen reader names it. */
export interface CurrencyTab {
  currency: string;
  /** The Group's main currency, marked "· main". */
  main: boolean;
  /** "¥186,000", or a member's position such as "−₹1,480.00". */
  figure: string;
  figureTone?: TextTone;
  /** "JPY, ¥186,000 spent in 24 Expenses". */
  name: string;
}

/**
 * A choice of one of a Group's currencies (#710 boards): a tab per currency with a figure in it,
 * the main currency marked, the chosen one outlined. The tabs wrap onto more lines when they
 * don't fit on one, as at large text, rather than clip. Nothing is converted between them.
 */
export function CurrencyTabs({
  label,
  tabs,
  value,
  onChange,
}: {
  /** The tablist's name, such as "Spending in". */
  label: string;
  tabs: readonly CurrencyTab[];
  value: string;
  onChange: (currency: string) => void;
}) {
  const theme = useTheme();
  // A drag that starts on a tab never chooses it (#693).
  const tap = useTap();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
    >
      {tabs.map((tab) => {
        const selected = tab.currency === value;
        return (
          <Pressable
            key={tab.currency}
            accessibilityRole="tab"
            accessibilityLabel={tab.name}
            accessibilityState={{ selected }}
            {...tap.on(() => onChange(tab.currency))}
            style={{ maxWidth: '100%' }}
          >
            <View
              // Remounted on selection: Android keeps corners square when a background changes.
              key={selected ? 'selected' : 'idle'}
              style={{
                minHeight: 56,
                justifyContent: 'center',
                gap: 1,
                // The chosen tab's border is twice as wide, inside the same size.
                paddingVertical: selected ? 7 : 8,
                paddingHorizontal: selected ? 13 : 14,
                borderRadius: 12,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? theme.brand.main : theme.borderStrong,
                backgroundColor: selected ? theme.brand.bg : theme.surface,
              }}
            >
              <CompactText
                variant="caption"
                tone={selected ? 'brand' : 'secondary'}
                spare
                style={{ fontFamily: fonts.mono }}
              >
                {tab.currency}
                {tab.main ? (
                  <CompactText
                    variant="caption"
                    tone={selected ? 'brand' : 'secondary'}
                    weight="medium"
                  >
                    {' · main'}
                  </CompactText>
                ) : null}
              </CompactText>
              <Money
                size="table"
                tone={tab.figureTone ?? 'primary'}
              >{`${tab.figure}${hairSpace}`}</Money>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
