import { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getCurrency } from '@splitbook/shared/currency';
import { MAX_EXTRA_CURRENCIES } from '@splitbook/shared/group-currencies';
import { extraCurrencyRow } from '@splitbook/shared/group-currency-settings';
import type { CurrencyAddState, GroupCurrenciesState } from '../data/types';
import { AddCurrencySheet } from './add-currency-sheet';
import {
  Banner,
  Card,
  CompactButton,
  CompactText,
  Divider,
  LinearProgress,
  SectionHeader,
  TopBar,
  progressHeight,
  radius,
} from './compact';
import { ReadTime } from './financial-views';
import { NotAvailableOffline } from './offline-notice';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';

/** A currency's code in its tile, as the Currency sheet draws it. */
function CodeTile({ code }: { code: string }) {
  const theme = useTheme();
  return (
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
  );
}

/** One currency of the Group: its code, its name, and what is said of it. */
function CurrencyRow({ code, line, locked }: { code: string; line: string; locked?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 14,
        paddingVertical: 8,
      }}
    >
      <CodeTile code={code} />
      <View style={{ flex: 1, gap: 2 }}>
        <CompactText weight="semibold">{getCurrency(code)?.name ?? code}</CompactText>
        <CompactText variant="small" tone="secondary">
          {line}
        </CompactText>
      </View>
      {locked ? (
        <View accessible accessibilityLabel="Locked">
          <Icon name="lock-closed-outline" size={20} color={theme.textSecondary} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * A Group's currencies (#722, board "Group currencies (removing points to the web)"), over its
 * view: the main currency and its lock, then each extra currency with what uses it and who added
 * it. Any member adds one here, online; removing one is on the web for now, where an admin can
 * remove one that nothing uses. Offline it shows this phone's copy, read only, with its time.
 */
export function GroupCurrencies({
  groupName,
  viewerId,
  state,
  offline,
  adding,
  now = new Date(),
  onAdd,
  onOpenWeb,
  onRetry,
  onClose,
}: {
  groupName: string;
  viewerId: string;
  state: GroupCurrenciesState;
  offline: boolean;
  adding: CurrencyAddState;
  /** Today, for the day each currency was added. */
  now?: Date;
  /** Resolves true once the Group has the currency. */
  onAdd: (currency: string) => Promise<boolean> | void;
  onOpenWeb: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [sheet, setSheet] = useState(false);
  const { data } = state;
  const extras = data?.extraCurrencies ?? [];
  const full = extras.length >= MAX_EXTRA_CURRENCIES;
  const listed = data ? [data.mainCurrency.code, ...extras.map(({ code }) => code)] : [];
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <TopBar
          title="Currencies"
          subtitle={groupName}
          leading={{ kind: 'close', label: 'Close Currencies', onPress: onClose }}
        />
        <View style={{ height: progressHeight }}>
          {state.status === 'loading' ? <LinearProgress label="Loading currencies" /> : null}
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 96 }}>
          <View style={{ gap: 12 }}>
            <CompactText variant="small" tone="secondary" style={{ paddingHorizontal: 2 }}>
              Expenses and payments in {groupName} can use any of these. Nothing is converted.
            </CompactText>
            {data && state.refreshedAt !== null ? (
              <View style={{ paddingHorizontal: 2 }}>
                <ReadTime
                  refreshedAt={state.refreshedAt}
                  restored={state.restored === true}
                  offline={offline}
                />
              </View>
            ) : null}
            {state.status === 'error' && state.message && data ? (
              <Banner tone="error" message={state.message} />
            ) : null}
            {state.status === 'error' && !data ? (
              <NotAvailableOffline
                compact
                message={state.message ?? 'Couldn’t load the currencies. Please try again.'}
                onRetry={onRetry}
              />
            ) : null}
            {data ? (
              <>
                <View style={{ gap: 6 }}>
                  <SectionHeader title="Main currency" />
                  <Card>
                    <CurrencyRow
                      code={data.mainCurrency.code}
                      line={
                        data.mainCurrency.locked
                          ? `Locked: money is already recorded in ${data.mainCurrency.code}`
                          : 'It can change on the web until money is recorded'
                      }
                      locked={data.mainCurrency.locked}
                    />
                  </Card>
                </View>
                <View style={{ gap: 6 }}>
                  <SectionHeader
                    title="Extra currencies"
                    trailing={
                      <CompactText variant="caption" tone="secondary">
                        {extras.length} of {MAX_EXTRA_CURRENCIES}
                      </CompactText>
                    }
                  />
                  {extras.length ? (
                    <Card>
                      {extras.map((setting, index) => (
                        <View key={setting.code}>
                          {index > 0 ? <Divider /> : null}
                          <CurrencyRow
                            code={setting.code}
                            line={extraCurrencyRow(setting, { viewerId, now }).line}
                          />
                        </View>
                      ))}
                    </Card>
                  ) : (
                    <CompactText tone="secondary" style={{ paddingHorizontal: 2 }}>
                      None yet. Add one for a trip abroad.
                    </CompactText>
                  )}
                  <CompactButton
                    label="Add a currency"
                    icon="add"
                    variant="tonal"
                    block
                    disabled={offline || full}
                    hint={
                      offline
                        ? 'Adding a currency needs a connection.'
                        : full
                          ? `A Group can have at most ${MAX_EXTRA_CURRENCIES} extra currencies.`
                          : undefined
                    }
                    onPress={() => setSheet(true)}
                  />
                  <CompactText variant="caption" tone="secondary" style={{ paddingHorizontal: 2 }}>
                    Anyone in the Group can add one. Activity shows who added it.
                  </CompactText>
                </View>
                <Banner
                  tone="info"
                  standing
                  title="Removing a currency is on the web for now."
                  message="An admin can remove one that nothing uses."
                >
                  <CompactButton
                    label="Open on the web"
                    icon="open-outline"
                    variant="text"
                    dense
                    onPress={onOpenWeb}
                  />
                </Banner>
              </>
            ) : null}
          </View>
        </ScrollView>
        {sheet && data ? (
          <AddCurrencySheet
            visible
            groupName={groupName}
            listed={listed}
            extraCount={extras.length}
            adding={adding.status === 'adding'}
            message={adding.status === 'error' ? adding.message : null}
            onAdd={(currency) =>
              void Promise.resolve(onAdd(currency)).then((added) => added && setSheet(false))
            }
            onCancel={() => setSheet(false)}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}
