import { Fragment, createContext, type ReactNode } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../theme';
import { Icon, type IconName } from '../primitives';
import { lineBox, radius, touch } from './scale';
import { CompactText } from './text';

export type BannerTone = 'info' | 'warning' | 'error' | 'offline';

/**
 * The colour a text action inside a Banner takes: its tone's status colour, as on the web (#782,
 * #807). Null outside a Banner, and in an offline one, whose neutral tone has none: there its
 * actions keep the brand.
 */
export const BannerActionColor = createContext<string | null>(null);

const bannerIcons: Record<BannerTone, IconName> = {
  info: 'information-circle-outline',
  warning: 'alert-circle-outline',
  error: 'alert-circle-outline',
  offline: 'cloud-offline-outline',
};

/** A place a sentence names, as a link to it: its words, and what a screen reader says. */
export interface SentenceLink {
  name: string;
  label: string;
  onPress: () => void;
}

/**
 * A sentence that ends in links, joined as "A, B and C": "Fix Amount, Description and Tag."
 * Android speaks a link nested in a text by its words alone ("Amount", never "Go to Amount") and
 * gives it only the line's height to touch, so the sentence is a row of words and each link a
 * control of its own, spoken as its label, its touch box 48 dp tall. Its padding is given back by
 * a negative margin, so it takes only its line's room. It reaches no wider than its words, so the
 * names either side of a comma never overlap. A screen reader reads the sentence whole, then each
 * link.
 */
function LinkedSentence({
  lead,
  links,
  color,
  linkColor,
}: {
  lead: string;
  links: SentenceLink[];
  color: string;
  linkColor: string;
}) {
  const { fontScale } = useWindowDimensions();
  const vertical = Math.max(0, (touch.min - lineBox('small', fontScale).height) / 2);
  const after = (index: number) =>
    index === links.length - 1 ? '.' : index === links.length - 2 ? ' and ' : ', ';
  const sentence = `${lead} ${links.map((link, index) => link.name + after(index)).join('')}`;
  return (
    <View
      accessible
      accessibilityLabel={sentence}
      style={{ flexDirection: 'row', flexWrap: 'wrap' }}
    >
      {lead.split(' ').map((word, index) => (
        <CompactText key={index} variant="small" style={{ color }}>
          {`${word} `}
        </CompactText>
      ))}
      {links.map((link, index) => (
        // A comma or full stop stays with its name; "and" is a word of its own, so the sentence
        // wraps between words as a text does (#646).
        <Fragment key={link.name}>
          <View style={{ flexDirection: 'row' }}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={link.label}
              onPress={link.onPress}
              style={{
                paddingVertical: vertical,
                marginVertical: -vertical,
              }}
            >
              <CompactText
                variant="small"
                weight="semibold"
                style={{ color: linkColor, textDecorationLine: 'underline' }}
              >
                {link.name}
              </CompactText>
            </Pressable>
            <CompactText variant="small" style={{ color }}>
              {index === links.length - 1 ? '.' : index === links.length - 2 ? ' ' : ', '}
            </CompactText>
          </View>
          {index === links.length - 2 ? (
            <CompactText variant="small" style={{ color }}>
              and{' '}
            </CompactText>
          ) : null}
        </Fragment>
      ))}
    </View>
  );
}

/**
 * A compact message in context. Info marks an ordinary draft; warning marks a save that may
 * already be recorded or a conflict; error lists corrections; offline marks saved figures.
 * The headline (the title, or the message when there is none) uses the tone's status
 * foreground; the explanation under a title stays secondary so inline links stand out.
 * Warning and error interrupt screen readers; info and offline are announced politely.
 */
export function Banner({
  tone,
  title,
  message,
  links,
  standing = false,
  heading = false,
  trailing,
  children,
}: {
  tone: BannerTone;
  title?: string;
  /** The title heads what follows, such as a duplicate's details: read as a heading. */
  heading?: boolean;
  /** With `links`, the words before them, such as "Your draft is kept. Fix". */
  message: string;
  /** Links that end the message as one sentence: "Fix Amount, Description and Tag." */
  links?: SentenceLink[];
  /** A notice that stays on the screen, e.g. an unconfirmed payment: announced politely. */
  standing?: boolean;
  /** Beside the title, such as a draft's amount. */
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const colors = {
    info: [theme.info.bg, theme.status.info],
    warning: [theme.warning.bg, theme.status.warning],
    error: [theme.negative.bg, theme.status.negative],
    offline: [theme.surfaceMuted, theme.textSecondary],
  }[tone];
  const urgent = !standing && (tone === 'warning' || tone === 'error');
  return (
    <View
      accessibilityRole={urgent ? 'alert' : 'summary'}
      accessibilityLiveRegion={urgent ? 'assertive' : 'polite'}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: radius.tile,
        backgroundColor: colors[0],
      }}
    >
      <Icon name={bannerIcons[tone]} size={20} color={colors[1]} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <CompactText
              variant="small"
              weight="semibold"
              accessibilityRole={heading ? 'header' : undefined}
              style={{ flex: 1, color: colors[1] }}
            >
              {title}
            </CompactText>
            {trailing}
          </View>
        ) : null}
        {links?.length ? (
          <LinkedSentence
            lead={message}
            links={links}
            color={title ? theme.textSecondary : colors[1]}
            linkColor={colors[1]}
          />
        ) : (
          <CompactText
            variant="small"
            tone="secondary"
            style={title ? undefined : { color: colors[1] }}
          >
            {message}
          </CompactText>
        )}
        {children ? (
          // Its actions go onto a second line where large text leaves no room beside each other,
          // as "Resume draft" and "Discard draft" do at 130% on a 360dp phone (#664).
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, marginLeft: -4 }}
          >
            <BannerActionColor.Provider value={tone === 'offline' ? null : colors[1]}>
              {children}
            </BannerActionColor.Provider>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export type BadgeTone = 'positive' | 'negative' | 'warning' | 'neutral';

/** A short status pill such as "Adds up", "Not confirmed" or "Saved 10:42". */
export function Badge({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
}) {
  const theme = useTheme();
  const colors = {
    positive: [theme.positive.bg, theme.status.positive],
    negative: [theme.negative.bg, theme.status.negative],
    warning: [theme.warning.bg, theme.status.warning],
    neutral: [theme.surfaceMuted, theme.textSecondary],
  }[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingVertical: 3,
        paddingLeft: icon ? 6 : 8,
        paddingRight: 8,
        backgroundColor: colors[0],
      }}
    >
      {icon ? <Icon name={icon} size={16} color={colors[1]} /> : null}
      <CompactText variant="caption" weight="semibold" spare style={{ color: colors[1] }}>
        {label}
      </CompactText>
    </View>
  );
}

/**
 * A transient confirmation in inverse colours, e.g. "Expense saved" or "Saved to August" with
 * "View". Placed above the bottom navigation; the floating action moves above it.
 */
export function Snackbar({
  message,
  action,
  bottom = 92,
}: {
  message: string;
  action?: { label: string; onPress: () => void };
  bottom?: number;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom,
        minHeight: 48,
        borderRadius: radius.tile,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        paddingLeft: 16,
        paddingRight: 6,
        backgroundColor: theme.text,
        elevation: 6,
      }}
    >
      <CompactText variant="small" tone="inverse" style={{ flex: 1, fontSize: 14 }}>
        {message}
      </CompactText>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={{ minHeight: touch.min, paddingHorizontal: 12, justifyContent: 'center' }}
        >
          <CompactText weight="semibold" spare style={{ color: theme.brand.bg, fontSize: 14 }}>
            {action.label}
          </CompactText>
        </Pressable>
      ) : null}
    </View>
  );
}
