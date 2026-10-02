import { ActivityIndicator, Pressable, View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { formatSignedCurrency, type MoneyTone } from '@splitbook/shared/money';
import type { HomeFinancialState, LoadStatus } from '../data/types';
import { Button, Copy, Icon, Label, Panel, type IconName } from './primitives';
import { refreshedLabel } from './refresh-feedback';
import { fonts, useTheme } from './theme';

export interface HomeBalancesProps {
  state: HomeFinancialState;
  onRefresh: () => void;
}

function Amount({
  value,
  currency,
  tone = 'neutral',
  large = false,
  signed = false,
}: {
  value: number;
  currency: string;
  tone?: MoneyTone;
  large?: boolean;
  signed?: boolean;
}) {
  const theme = useTheme();
  return (
    <Copy
      style={{
        fontFamily: fonts.mono,
        fontSize: large ? 26 : 20,
        lineHeight: large ? 36 : 29,
        color: tone === 'neutral' ? theme.text : theme.status[tone],
      }}
    >
      {signed ? formatSignedCurrency(value, currency) : formatCurrency(value, currency)}{' '}
      <Copy style={{ fontSize: 12, lineHeight: 20, color: theme.textSecondary }}>{currency}</Copy>
    </Copy>
  );
}

function IconAction({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        minWidth: 48,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.brand.bg,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={21} color={theme.brand.main} />
    </Pressable>
  );
}

function FinancialState({
  status,
  message,
  loadingLabel,
  retryLabel,
  onRetry,
}: {
  status: LoadStatus;
  message: string | null;
  loadingLabel: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  if (status === 'ready') return null;
  const loading = status === 'idle' || status === 'loading';
  return (
    <View style={{ gap: 14, paddingVertical: 8 }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {loading ? (
          <ActivityIndicator color={theme.brand.main} />
        ) : (
          <Icon name="cloud-offline-outline" color={theme.status.negative} />
        )}
        <Copy
          accessibilityRole={loading ? undefined : 'alert'}
          style={{ flex: 1, color: loading ? theme.textSecondary : theme.status.negative }}
        >
          {loading ? loadingLabel : (message ?? 'These figures could not be loaded. Try again.')}
        </Copy>
      </View>
      {!loading && <Button label={retryLabel} secondary onPress={onRetry} />}
    </View>
  );
}

/**
 * The one quiet cue for an automatic refresh or retry of content that stays on screen,
 * with when that content was verified when known.
 */
export function RefreshStatus({
  visible,
  savedAt = null,
}: {
  visible: boolean;
  savedAt?: number | null;
}) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
      <Icon name="sync-outline" size={15} />
      <Copy style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 20, flexShrink: 1 }}>
        {savedAt === null ? 'Updating…' : `Saved ${refreshedLabel(savedAt)} · updating`}
      </Copy>
    </View>
  );
}

/**
 * Explains figures that stay visible but are not current: still being verified
 * after a ledger change, or kept after a refresh failed.
 */
export function RetainedNotice({
  status,
  stale,
  refreshedAt,
  message,
  subject,
  retryLabel,
  onRetry,
}: {
  status: LoadStatus;
  stale: boolean;
  refreshedAt: number | null;
  message: string | null;
  subject: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const time = refreshedLabel(refreshedAt);
  if (status === 'error')
    return (
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Icon name="cloud-offline-outline" color={theme.status.negative} />
          <Copy accessibilityRole="alert" style={{ flex: 1, color: theme.status.negative }}>
            {message ?? `Couldn’t refresh ${subject}.`} Showing {subject} from {time}.
          </Copy>
        </View>
        <Button label={retryLabel} secondary onPress={onRetry} />
      </View>
    );
  if (!stale) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Icon name="sync-outline" color={theme.textSecondary} />
      <Copy style={{ flex: 1, color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
        Updating {subject}. These figures are from {time} and may change.
      </Copy>
    </View>
  );
}

export function HomeBalances({ state, onRefresh }: HomeBalancesProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Label>AT A GLANCE</Label>
          <Copy
            accessibilityRole="header"
            style={{ fontFamily: fonts.semibold, fontSize: 25, lineHeight: 32 }}
          >
            Your balances
          </Copy>
        </View>
        <IconAction
          label="Refresh Home balances"
          icon="refresh-outline"
          onPress={onRefresh}
          disabled={state.status === 'loading'}
        />
      </View>
      <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
        Across your active Groups. Each currency stays separate.
      </Copy>
      {state.data !== null && (
        <RetainedNotice
          status={state.status}
          stale={state.stale}
          refreshedAt={state.refreshedAt}
          message={state.message}
          subject="your balances"
          retryLabel="Retry Home balances"
          onRetry={onRefresh}
        />
      )}
      {state.data === null ? (
        <Panel>
          <FinancialState
            status={state.status === 'ready' ? 'error' : state.status}
            message={state.message}
            loadingLabel="Loading your balances…"
            retryLabel="Retry Home balances"
            onRetry={onRefresh}
          />
        </Panel>
      ) : state.data.length ? (
        state.data.map((bucket) => (
          <Panel key={bucket.currency}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="wallet-outline" size={19} color={theme.brand.main} />
              <Label>{bucket.currency}</Label>
            </View>
            {[
              { label: 'You owe', value: bucket.youOwe, tone: 'negative' as const },
              { label: 'You are owed', value: bucket.youAreOwed, tone: 'positive' as const },
            ].map((item) => (
              <View
                key={item.label}
                style={{
                  backgroundColor: theme[item.tone].bg,
                  borderRadius: 12,
                  padding: 16,
                  gap: 5,
                }}
              >
                <Copy style={{ fontFamily: fonts.medium, color: theme.status[item.tone] }}>
                  {item.label}
                </Copy>
                <Amount value={item.value} currency={bucket.currency} tone={item.tone} large />
              </View>
            ))}
          </Panel>
        ))
      ) : (
        <Panel>
          <Icon name="checkmark-circle-outline" color={theme.status.positive} size={28} />
          <Copy style={{ fontFamily: fonts.semibold, fontSize: 20 }}>Nothing outstanding</Copy>
          <Copy style={{ color: theme.textSecondary }}>
            You have no outstanding balances in your active Groups.
          </Copy>
        </Panel>
      )}
    </View>
  );
}
