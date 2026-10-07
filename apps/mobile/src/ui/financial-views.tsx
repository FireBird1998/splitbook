import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { LoadStatus } from '../data/types';
import { Badge, CompactText, StatusText, useLargeText, type TextTone } from './compact';
import { Button, Copy, Icon } from './primitives';
import { refreshedLabel } from './refresh-feedback';
import { useTheme } from './theme';

/**
 * The one quiet cue for a refresh or retry of content that stays on screen; `checking` marks
 * the saved Home while the session is checked. It gives no time: what is shown says when it
 * was read, "Saved" only for this device's copy, so a top bar never calls an answer from this
 * session "Saved".
 *
 * It stays on one line (#332). At large text its words say it alone, without the icon: on a
 * 360dp phone at 130% the icon left "Refreshing…" 6dp short, and it wrapped. Wherever it still
 * doesn't fit, it shrinks to fit rather than wrap or lose a word.
 */
export function RefreshStatus({
  visible,
  checking = false,
}: {
  visible: boolean;
  checking?: boolean;
}) {
  const large = useLargeText();
  if (!visible) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
      {large ? null : <Icon name="sync-outline" size={15} />}
      <StatusText
        shrink
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ fontSize: 13, lineHeight: 20 }}
      >
        {checking ? 'Checking…' : 'Refreshing…'}
      </StatusText>
    </View>
  );
}

/**
 * Says `children` in the place `holds` takes: an unseen, unread copy of `holds` keeps that place
 * at its size, so a short status standing in for a longer text moves nothing around it, whatever
 * the text size (#219). With `holds` null, `children` take their own place. The same `children`
 * stay mounted either way, so a status in them can change its text in place. A plain function,
 * drawn as part of the component that calls it.
 */
export function inPlace({ holds, children }: { holds: ReactNode | null; children: ReactNode }) {
  return (
    <View>
      {holds === null ? null : (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ opacity: 0 }}
        >
          {holds}
        </View>
      )}
      <View
        style={
          holds === null
            ? undefined
            : {
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                justifyContent: 'center',
                alignItems: 'flex-end',
              }
        }
      >
        {children}
      </View>
    </View>
  );
}

/**
 * When a Group's Expenses or Balances, or Home's figures, shown were read, in their own slot:
 * "Updated hh:mm" for the server's answer in this session, offline too; this device's restored
 * copy says "Saved hh:mm", never presented as fresh (ADR 0006), and offline it is the badge every
 * saved view shows (#219, as Home's since #332). An ordinary refresh changes nothing here: the
 * screen's one progress cue says it. Figures a change has made out of date (`updating`) say
 * "Updating…" where their time was, in its place, until they're read again, so the member never
 * takes an old debt for a current one, and nothing below moves.
 */
export function ReadTime(props: ReadTimeProps) {
  return readTime(props);
}

export interface ReadTimeProps {
  refreshedAt: number | null;
  /** The figures are this device's saved copy. */
  restored?: boolean;
  offline?: boolean;
  /** Out of date since a change, and being read again. */
  updating?: boolean;
  tone?: TextTone;
}

/**
 * `ReadTime`'s slot, for a component that draws it as part of its own render, as Home's
 * balances do, so Home renders no more components than before (#219).
 */
export function readTime({
  refreshedAt,
  restored = false,
  offline = false,
  updating = false,
  tone = 'secondary',
}: ReadTimeProps) {
  if (refreshedAt === null) return null;
  const time = refreshedLabel(refreshedAt);
  if (restored && offline && !updating) return <Badge label={`Saved ${time}`} />;
  const read = `${restored ? 'Saved' : 'Updated'} ${time}`;
  return inPlace({
    holds: updating ? (
      <CompactText variant="caption" tone={tone}>
        {read}
      </CompactText>
    ) : null,
    children: (
      // Into "Updating…" at once, never fading from the time beside it; back out with a fade.
      <StatusText tone={tone} instant={updating}>
        {updating ? 'Updating…' : read}
      </StatusText>
    ),
  });
}

/**
 * A Group whose details couldn't be read, though its Expenses were, in this open (owner decision
 * 2A, #219): it says what failed and what is current, with a retry. Nothing is out of date, so it
 * shows no time, and the failure isn't the connection's.
 */
export function DetailsNotice({
  subject,
  balances,
  onRetry,
}: {
  subject: string;
  /** Balances were read too, after the Expenses. */
  balances: boolean;
  onRetry: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Icon name="alert-circle-outline" color={theme.status.negative} />
        {/* Its words change in place once Balances are read: they fade, as a status does. */}
        <StatusText
          shrink
          variant="body"
          tone="negative"
          accessibilityRole="alert"
          style={{ fontSize: 16, lineHeight: 24 }}
        >
          {`Couldn’t load ${subject}’s details. ${
            balances
              ? 'Expenses and balances below are up to date.'
              : 'Expenses below are up to date.'
          }`}
        </StatusText>
      </View>
      <Button label="Retry Group" secondary onPress={onRetry} />
    </View>
  );
}

/**
 * Explains figures kept on screen after a refresh failed, with when they were read and a retry:
 * beside the offline cloud while SplitBook can't be reached, otherwise beside the error icon, so
 * a server error never looks like a lost connection (#219). Figures read again after a ledger
 * change say nothing here: they keep their place and their time, and the screen's one progress
 * cue says they're being read, so nothing moves (#219).
 */
export function RetainedNotice({
  status,
  refreshedAt,
  message,
  subject,
  retryLabel,
  offline = false,
  onRetry,
}: {
  status: LoadStatus;
  refreshedAt: number | null;
  message: string | null;
  subject: string;
  retryLabel: string;
  /** The app can't reach SplitBook, as its offline banner says. */
  offline?: boolean;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const time = refreshedLabel(refreshedAt);
  if (status !== 'error') return null;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Icon
          name={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
          color={theme.status.negative}
        />
        <Copy accessibilityRole="alert" style={{ flex: 1, color: theme.status.negative }}>
          {message ?? `Couldn’t refresh ${subject}.`} Showing {subject} from {time}.
        </Copy>
      </View>
      <Button label={retryLabel} secondary onPress={onRetry} />
    </View>
  );
}
