import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import type { OverviewWidgetView } from '@splitbook/shared/overview-widget';
import type { WidgetTarget } from '@splitbook/shared/balances-widget';
import type { SemanticTokens } from '@splitbook/shared/design-tokens';
import Constants from 'expo-constants';
import { widgetLink } from './widget-links';
import { hiddenLabel } from './widget-hidden-label';
import lightMark from '../assets/widgets/mark-light.svg';
import darkMark from '../assets/widgets/mark-dark.svg';

/** Draw the measured plan; size, admission, wrapping and type fitting belong to the view. */
export function drawOverview(view: OverviewWidgetView, t: SemanticTokens) {
  const l = view.layout,
    f = l.fonts;
  const color = (value: string) => value as `#${string}`;
  const link = (target: WidgetTarget) => ({
    uri: widgetLink(target, __DEV__ ? Constants.expoConfig?.hostUri : undefined),
  });
  const text = (value: string, ink = t.text, size = f.body, bold = false, mono = false) => (
    <TextWidget
      text={value}
      maxLines={1}
      truncate="END"
      style={{
        color: color(ink),
        fontSize: size,
        fontWeight: bold ? 'bold' : 'normal',
        ...(mono ? { fontFamily: 'monospace' } : {}),
      }}
    />
  );
  const lines = (values: string[], ink = t.text, size = f.body, bold = false) =>
    values.map((value, i) => (
      <FlexWidget key={i} style={{ width: 'match_parent' }}>
        {text(value, ink, size, bold)}
      </FlexWidget>
    ));
  const mark = (
    <SvgWidget svg={t.mode === 'dark' ? darkMark : lightMark} style={{ width: 16, height: 16 }} />
  );
  const column = (label: string, amounts: string[], more: string | null, tone: string) => (
    <FlexWidget
      style={{
        ...(l.columns ? { flex: 1 } : {}),
        ...(l.panel
          ? { padding: 10, backgroundColor: color(t.surfaceMuted), borderRadius: 14 }
          : {}),
      }}
    >
      {text(label, tone, f.label, true)}
      {amounts.length
        ? amounts.map((amount, i) => (
            <FlexWidget key={i}>
              {text(amount, view.muted ? t.textMuted : t.text, f.money, !view.hidden, !view.hidden)}
            </FlexWidget>
          ))
        : text('—', t.textMuted, f.money)}
      {more && l.showOverflow ? text(more, t.textSecondary, f.small) : null}
    </FlexWidget>
  );

  const balance = l.compactFallback ? (
    <FlexWidget>{lines(l.fallbackLines, t.textSecondary, f.small)}</FlexWidget>
  ) : l.compactLines.length ? (
    <FlexWidget>
      {l.compactLines.map((line, i) => (
        <FlexWidget key={i}>
          {text(
            line,
            view.muted ? t.textMuted : i ? t.status.negative : t.status.positive,
            f.compact,
            true,
          )}
        </FlexWidget>
      ))}
    </FlexWidget>
  ) : l.small && !view.hidden ? (
    <FlexWidget style={{ flexGap: 2 }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 4 }}>
        {text(l.primary.amount, view.muted ? t.textMuted : t.text, f.money, true, true)}
        {l.showOverflow && l.primary.overflow
          ? text(l.primary.overflow!, t.textSecondary, f.small)
          : null}
      </FlexWidget>
      {l.secondary
        ? text(l.secondary, view.muted ? t.textMuted : t.status.negative, f.secondary, true)
        : null}
    </FlexWidget>
  ) : (
    <FlexWidget
      style={{
        width: 'match_parent',
        flexDirection: l.columns ? 'row' : 'column',
        flexGap: l.columns ? 8 : 6,
      }}
    >
      {column('You’re owed', view.owed, view.owedOverflow, t.status.positive)}
      {column('You owe', view.owe, view.oweOverflow, t.status.negative)}
    </FlexWidget>
  );
  const message = (
    <FlexWidget style={{ width: 'match_parent', flexGap: 8 }}>
      <FlexWidget
        style={{
          flexDirection: 'row',
          flexGap: 12,
          width: 'match_parent',
          alignItems: 'flex-start',
        }}
      >
        {l.showStateTile ? (
          <FlexWidget
            style={{
              width: 48,
              height: 48,
              backgroundColor: color(t.surfaceMuted),
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {view.state === 'signed-out' ? (
              mark
            ) : view.state === 'expired' ? (
              <SvgWidget
                svg={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><g fill="none" stroke="${t.textSecondary}" stroke-width="1.8"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></g></svg>`}
                style={{ width: 24, height: 24 }}
              />
            ) : (
              text(view.state === 'all-square' ? '✓' : '!', t.textSecondary, 24, true)
            )}
          </FlexWidget>
        ) : null}
        <FlexWidget style={{ flex: 1 }}>{lines(l.titleLines, t.text, f.title, true)}</FlexWidget>
      </FlexWidget>
      {lines(l.descriptionLines, t.textSecondary, f.body)}
    </FlexWidget>
  );
  const footer = (
    <FlexWidget
      style={{
        width: 'match_parent',
        flexDirection: l.footerAcross ? 'row' : 'column',
        alignItems: l.footerAcross ? 'center' : 'flex-start',
        justifyContent: 'space-between',
        flexGap: 4,
      }}
    >
      {view.review ? (
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={link(view.reviewTarget)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            backgroundColor: color(t.brand.bg),
            borderRadius: 16,
          }}
        >
          {text(view.review, t.brand.main, f.review, true)}
        </FlexWidget>
      ) : null}
      {!view.review && l.footerNote ? text(l.footerNote, t.textMuted, f.small) : null}
      {view.action ? (
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={link(view.actionTarget)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 9,
            backgroundColor: color(t.brand.bg),
            borderRadius: 14,
            alignItems: 'center',
          }}
        >
          {lines(l.actionLines, t.brand.main, f.action, true)}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
  const content: Record<string, React.ReactNode> = {
    header: (
      <FlexWidget
        style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6, width: 'match_parent' }}
      >
        {mark}
        <FlexWidget style={{ flex: 1 }}>
          {text(
            l.headerLabel,
            l.headerTone === 'positive'
              ? t.status.positive
              : l.headerTone === 'negative'
                ? t.status.negative
                : t.text,
            f.heading,
            true,
          )}
        </FlexWidget>
        {view.saved && l.showSaved
          ? text(view.saved, view.muted ? t.status.warning : t.textMuted, f.saved)
          : null}
      </FlexWidget>
    ),
    balance,
    message,
    footer,
    privacy: hiddenLabel(view.hidden ?? '', t, f.privacy),
    loading: (
      <FlexWidget style={{ height: 'match_parent' }}>
        {l.loadingRows.map((row, i) => (
          <FlexWidget
            key={i}
            style={{
              height: l.sections.find((s) => s.id === 'loading')?.rowHeight ?? 0,
              justifyContent: 'center',
            }}
          >
            <FlexWidget
              style={{
                width: row.width,
                height: 14,
                borderRadius: 6,
                backgroundColor: color(t.surfaceMuted),
              }}
            />
          </FlexWidget>
        ))}
      </FlexWidget>
    ),
  };
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={link(view.target)}
      accessibilityLabel={view.summary}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: l.padding,
        flexGap: l.gap,
        borderRadius: 24,
        backgroundColor: color(t.surface),
      }}
    >
      {l.sections.map((section) => (
        <FlexWidget
          key={section.id}
          style={{ width: 'match_parent', height: section.height, justifyContent: 'center' }}
        >
          {content[section.id]}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}
