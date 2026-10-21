import { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  formatAmountAsEntered,
  formatCurrencyAsEntered,
  getCurrency,
  getCurrencyPrecision,
} from '@splitbook/shared/currency';
import { MoneyValidationError, parseAmountMinor } from '@splitbook/shared/exact-money';
import { groupCurrencies, unlistedCurrencyFix } from '@splitbook/shared/group-currencies';
import type { CurrencyAddState, MobileGroup } from '../data/types';
import { PRODUCT_NAME } from '../product';
import { Banner, BottomSheet, CompactButton, CompactText, Money, useTap } from './compact';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';

/** What the sheets need of an item: its name, and its amount and currency as prepared. */
export interface UnlistedItem {
  description: string;
  /** "Prepared by Claude · Sun 12 Oct", as its row says it. */
  detail: string;
  amount: number | undefined;
  currency: string;
}

export const addNeedsConnection = 'Adding a currency needs a connection.';
const changeNeedsConnection = 'Changing the currency needs a connection.';

/** Whether a currency keeps the amount as it is: yen has no smaller unit to keep 86.50's 50 in. */
function keepsAmount(amount: number | undefined, currency: string) {
  if (amount === undefined) return true;
  try {
    parseAmountMinor(amount, currency);
    return true;
  } catch (error) {
    return !(error instanceof MoneyValidationError && error.code === 'INVALID_MONEY_PRECISION');
  }
}

/**
 * A To review item in a currency its Group doesn't list (#733, board "To review: unlisted
 * currency"): what's wrong, and the web's two fixes in the shared words (#732): add the currency
 * to the Group, which needs a connection, or change the item's currency and keep its amount.
 */
export function UnlistedCurrencySheet({
  item,
  group,
  offline,
  disabled,
  adding,
  onAdd,
  onChange,
  onClose,
}: {
  item: UnlistedItem;
  group: Pick<MobileGroup, 'name' | 'defaultCurrency' | 'alternateCurrencies'>;
  offline: boolean;
  /** The list's own reasons to wait, such as a save on its way. */
  disabled: boolean;
  adding: CurrencyAddState;
  onAdd: () => void;
  onChange: () => void;
  onClose: () => void;
}) {
  const fix = unlistedCurrencyFix(group, item.currency, item.amount);
  const busy = adding.status === 'adding';
  return (
    <BottomSheet visible title={item.description} doneLabel="Close" onDone={onClose}>
      {/* Both fixes wait for a connection: said once, above them, as well as under each. */}
      {offline ? (
        <Banner
          tone="offline"
          message="You’re offline. Adding or changing a currency needs a connection."
        />
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <CompactText variant="small" tone="secondary" style={{ flex: 1 }}>
          {item.detail}
        </CompactText>
        {item.amount !== undefined ? (
          <Money>{formatCurrencyAsEntered(item.amount, item.currency)}</Money>
        ) : null}
      </View>
      <Banner tone="warning" message={`${fix.notListed} ${fix.ask}`} />
      {adding.status === 'error' && adding.message ? (
        <Banner tone="error" message={adding.message} />
      ) : null}
      {fix.add ? (
        <CompactButton
          label={fix.add}
          icon="add"
          block
          disabled={offline || disabled || busy}
          busy={busy ? `Adding ${item.currency}…` : undefined}
          hint={offline ? addNeedsConnection : undefined}
          onPress={onAdd}
        />
      ) : null}
      <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
        {offline && fix.add ? addNeedsConnection : fix.adding}
      </CompactText>
      <CompactButton
        label="Change currency"
        variant="tonal"
        block
        disabled={offline || disabled || busy}
        hint={offline ? changeNeedsConnection : undefined}
        onPress={onChange}
      />
      <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
        {fix.changing}
      </CompactText>
    </BottomSheet>
  );
}

/**
 * Change currency (#733, board "To review: change the currency"): one of the Group's currencies
 * for the item. Its amount stays as entered; nothing is converted, so the sheet says to check it
 * against the receipt. A currency that can't keep the amount, as yen can't keep 86.50, isn't
 * offered, and its row says why.
 */
export function ChangeCurrencySheet({
  item,
  group,
  disabled,
  onUse,
  onClose,
}: {
  item: UnlistedItem;
  group: Pick<MobileGroup, 'name' | 'defaultCurrency' | 'alternateCurrencies'>;
  disabled: boolean;
  onUse: (currency: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  // A drag that starts on a currency never picks it (#665).
  const tap = useTap();
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <BottomSheet
      visible
      title="Change currency"
      doneLabel="Cancel"
      onDone={onClose}
      footer={
        <CompactButton
          label={chosen ? `Use ${chosen}` : 'Choose a currency'}
          block
          disabled={!chosen || disabled}
          onPress={() => chosen && onUse(chosen)}
        />
      }
    >
      <CompactText variant="small" tone="secondary">
        {`Pick one of ${group.name}’s currencies for ${item.description}.`}
      </CompactText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Currency"
        style={{ marginHorizontal: -20 }}
      >
        {groupCurrencies(group).map((code) => {
          const name = getCurrency(code)?.name ?? code;
          const kept = keepsAmount(item.amount, code);
          const notes = [
            code === group.defaultCurrency ? 'Main currency' : null,
            getCurrencyPrecision(code) === 0 ? 'Whole amounts only' : null,
            kept || item.amount === undefined
              ? null
              : `Can’t keep ${formatAmountAsEntered(item.amount, item.currency)}`,
          ].filter((note): note is string => !!note);
          const checked = code === chosen;
          return (
            <Pressable
              key={code}
              accessibilityRole="radio"
              accessibilityLabel={[code, name, ...notes.map((note) => note.toLowerCase())].join(
                ', ',
              )}
              accessibilityState={{ checked, disabled: disabled || !kept }}
              disabled={disabled || !kept}
              {...tap.on(() => kept && setChosen(code))}
              style={{
                minHeight: 56,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 20,
                paddingVertical: 6,
                backgroundColor: checked ? theme.brand.bg : 'transparent',
              }}
            >
              {/* One it can't be changed to reads as unavailable, in a colour still read at 4.5:1. */}
              <CompactText
                weight="semibold"
                tone={kept ? undefined : 'secondary'}
                style={{ minWidth: 48, textAlign: 'center', fontFamily: fonts.mono }}
              >
                {code}
              </CompactText>
              <View style={{ flex: 1, minWidth: 0 }}>
                <CompactText weight="semibold" tone={kept ? undefined : 'secondary'}>
                  {name}
                </CompactText>
                {notes.length ? (
                  <CompactText variant="caption" tone="secondary">
                    {notes.join(' · ')}
                  </CompactText>
                ) : null}
              </View>
              {checked ? <Icon name="checkmark" size={20} color={theme.brand.main} /> : null}
            </Pressable>
          );
        })}
      </View>
      {chosen && item.amount !== undefined ? (
        <Banner
          tone="info"
          message={`The amount stays ${formatAmountAsEntered(item.amount, item.currency)}, so it becomes ${formatCurrencyAsEntered(item.amount, chosen)}. ${PRODUCT_NAME} doesn’t convert it; check it against the receipt.`}
        />
      ) : null}
    </BottomSheet>
  );
}
