import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import type { BalancesWidgetView, WidgetTarget } from '@splitbook/shared/balances-widget';
import type { SemanticTokens } from '@splitbook/shared/design-tokens';
import Constants from 'expo-constants';
import { hiddenLabel } from './widget-hidden-label';
import { widgetLink } from './widget-links';
import lightMark from '../assets/widgets/mark-light.svg';
import darkMark from '../assets/widgets/mark-dark.svg';

export function drawBalances(view: BalancesWidgetView, t: SemanticTokens) {
  const small = view.size === '2x1',
    wide = view.size === '4x2',
    l = view.layout;
  const color = (v: string) => v as `#${string}`;
  const uri = (target: WidgetTarget) => ({
    uri: widgetLink(target, __DEV__ ? Constants.expoConfig?.hostUri : undefined),
  });
  const text = (value: string, tone = t.text, fontSize = 12, bold = false, mono = false) => (
    <TextWidget
      text={value}
      style={{
        color: color(tone),
        fontSize,
        fontWeight: bold ? 'bold' : 'normal',
        ...(mono ? { fontFamily: 'monospace' } : {}),
      }}
    />
  );
  const mark = (size = 16) => (
    <SvgWidget
      svg={t.mode === 'dark' ? darkMark : lightMark}
      style={{ width: size, height: size }}
    />
  );
  const compactMoney = small && view.state === 'normal' && !view.hidden;
  const column = (title: string, lines: string[], overflow: string | null, tone: string) => (
    <FlexWidget
      style={{
        flexGap: 2,
        ...(l.equalColumns ? { flex: 1 } : {}),
        ...(wide ? { padding: 10, backgroundColor: color(t.surfaceMuted), borderRadius: 16 } : {}),
      }}
    >
      {text(title, tone, view.hidden ? l.hiddenFontSize : 11, true)}
      {lines.length
        ? lines.map((line, i) => (
            <TextWidget
              key={i}
              text={line}
              style={{
                color: color(view.muted ? t.textMuted : t.text),
                fontSize: view.hidden ? l.hiddenFontSize : l.moneyFontSize,
                fontWeight: view.hidden ? 'normal' : 'bold',
                ...(view.hidden ? {} : { fontFamily: 'monospace' }),
              }}
            />
          ))
        : text('—', t.textMuted)}
      {overflow && l.showOverflow ? text(overflow, t.brand.main, 10, true) : null}
    </FlexWidget>
  );
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={uri(view.target)}
      accessibilityLabel={view.summary}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: small ? 10 : l.moneyFontSize === 13 ? 10 : 14,
        backgroundColor: color(t.surface),
        borderRadius: 24,
      }}
    >
      <FlexWidget style={{ width: 'match_parent', flexGap: small ? 4 : 8 }}>
        {l.showHeader ? (
          <FlexWidget
            style={{
              width: 'match_parent',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
              {mark(small ? 14 : 16)}
              {text(
                compactMoney ? (view.owed.length ? 'You’re owed' : 'You owe') : 'Balances',
                compactMoney ? (view.owed.length ? t.status.positive : t.status.negative) : t.text,
                small ? 10 : 11,
                true,
              )}
            </FlexWidget>
            {view.saved && l.showSavedInHeader
              ? text(view.saved, view.muted ? t.status.warning : t.textMuted, 9)
              : null}
          </FlexWidget>
        ) : null}
        {view.state === 'loading' ? (
          <FlexWidget style={{ flexGap: 10 }}>
            {(small ? [70, 120] : [70, 120, 60, 104]).map((width, i) => (
              <FlexWidget
                key={i}
                style={{
                  width,
                  height: i % 2 ? 16 : 10,
                  backgroundColor: color(t.surfaceMuted),
                  borderRadius: 6,
                }}
              />
            ))}
          </FlexWidget>
        ) : view.state !== 'normal' ? (
          <FlexWidget style={{ width: 'match_parent', flexGap: small ? 3 : 6 }}>
            {l.showTile ? (
              view.state === 'signed-out' ? (
                mark(30)
              ) : view.state === 'all-square' ? (
                text('✓', t.status.positive, 24, true)
              ) : view.state === 'expired' ? (
                <SvgWidget
                  svg={`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="${t.textSecondary}" stroke-width="2"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></g></svg>`}
                  style={{ width: 24, height: 24 }}
                />
              ) : null
            ) : null}
            {view.title ? text(view.title, t.text, l.stateTitleSize, true) : null}
            {view.description && l.showDescription
              ? text(view.description, t.textSecondary, small ? 10 : 12)
              : null}
          </FlexWidget>
        ) : view.compactFallback ? (
          <FlexWidget style={{ flexGap: 3 }}>
            <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
              {mark(14)}
              {text('Balances', t.text, 10, true)}
            </FlexWidget>
            {text(view.compactFallback, t.textSecondary, 9)}
          </FlexWidget>
        ) : view.compactLines.length ? (
          <FlexWidget style={{ flexGap: 2 }}>
            {view.compactLines.map((line, index) => (
              <TextWidget
                key={index}
                text={line}
                maxLines={1}
                style={{
                  color: color(index === 0 ? t.status.positive : t.status.negative),
                  fontSize: view.hidden ? 10 : l.moneyFontSize === 13 ? 10 : 12,
                  fontWeight: 'bold',
                }}
              />
            ))}
          </FlexWidget>
        ) : compactMoney ? (
          <FlexWidget style={{ flexGap: 2 }}>
            <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 4 }}>
              {text(
                (view.owed.length ? view.owed : view.owe)[0] ?? '—',
                view.muted ? t.textMuted : t.text,
                l.moneyFontSize,
                true,
                true,
              )}
              {l.showOverflow && (view.owed.length ? view.owedOverflow : view.oweOverflow)
                ? text(
                    (view.owed.length ? view.owedOverflow : view.oweOverflow)!,
                    t.brand.main,
                    10,
                    true,
                  )
                : null}
            </FlexWidget>
            {l.showSecondary && view.owed.length && view.owe.length ? (
              <FlexWidget style={{ flexDirection: 'row', flexGap: 6 }}>
                {text('You owe', t.status.negative, 10, true)}
                {text(view.owe[0]!, view.muted ? t.textMuted : t.text, 12, true, true)}
              </FlexWidget>
            ) : null}
          </FlexWidget>
        ) : (
          <FlexWidget
            style={{
              width: 'match_parent',
              flexDirection: wide || small ? 'row' : 'column',
              flexGap: wide ? 8 : 6,
            }}
          >
            {column('You’re owed', view.owed, view.owedOverflow, t.status.positive)}
            {column('You owe', view.owe, view.oweOverflow, t.status.negative)}
          </FlexWidget>
        )}
        {view.hidden && l.showPrivacyLabel ? hiddenLabel(view.hidden, t, l.privacyFontSize) : null}
      </FlexWidget>
      <FlexWidget style={{ flex: 1 }} />
      {!small ? (
        <FlexWidget
          style={{
            width: 'match_parent',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {view.state === 'no-groups' ? (
            <FlexWidget
              style={{ padding: 8, backgroundColor: color(t.brand.bg), borderRadius: 14 }}
            >
              {text('＋ Create a Group', t.brand.main, 12, true)}
            </FlexWidget>
          ) : view.muted ? (
            text('↻ Open to update', t.textMuted, 11)
          ) : view.review && l.showReview ? (
            <FlexWidget
              clickAction="OPEN_URI"
              clickActionData={uri('review')}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 5,
                backgroundColor: color(t.brand.bg),
                borderRadius: 16,
              }}
            >
              {text(view.review, t.brand.main, 11, true)}
            </FlexWidget>
          ) : null}
          {view.saved && l.showSavedInFooter
            ? text(view.saved, t.textMuted, 9)
            : view.footer && !view.muted
              ? text(view.footer, t.textSecondary, 10)
              : null}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}
