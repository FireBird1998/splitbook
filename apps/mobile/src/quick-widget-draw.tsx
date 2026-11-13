import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import { quickWidget, type QuickWidgetSetup } from '@splitbook/shared/quick-widget';
import type { WidgetDimensions } from '@splitbook/shared/widget-sizing';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';
import type { SemanticTokens } from '@splitbook/shared/design-tokens';
import { widgetLink } from './widget-links';
import Constants from 'expo-constants';
import lightMark from '../assets/widgets/mark-light.svg';
import darkMark from '../assets/widgets/mark-dark.svg';
import quickLight from '../assets/widgets/quick-tile-light.svg';
import quickDark from '../assets/widgets/quick-tile-dark.svg';
import paymentLight from '../assets/widgets/payment-tile-light.svg';
import paymentDark from '../assets/widgets/payment-tile-dark.svg';

export function drawQuick(
  copy: WidgetCopy | null,
  setup: QuickWidgetSetup,
  size: WidgetDimensions,
  session: WidgetSession,
  t: SemanticTokens,
  fontScale = 1,
) {
  const view = quickWidget(copy, setup, size, session, fontScale),
    l = view.layout;
  const color = (v: string) => v as `#${string}`;
  const tiles: Record<string, string | number> = {
    expense: t.mode === 'dark' ? quickDark : quickLight,
    payment: t.mode === 'dark' ? paymentDark : paymentLight,
    brand: t.mode === 'dark' ? darkMark : lightMark,
  };
  const paths: Record<string, string> = {
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    archive: '<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  };
  const icon =
    tiles[l.icon] ??
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="${t.textSecondary}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[l.icon]}</g></svg>`;
  if (view.shortcuts) {
    const shortcuts = view.shortcuts;
    return (
      <FlexWidget
        accessibilityLabel={view.summary}
        style={{
          width: 'match_parent',
          height: 'match_parent',
          padding: shortcuts.padding,
          borderRadius: 24,
          backgroundColor: color(t.surface),
          flexGap: shortcuts.gap,
          justifyContent: 'center',
        }}
      >
        {shortcuts.header ? (
          <FlexWidget
            style={{
              height: shortcuts.headerHeight,
              flexDirection: 'row',
              alignItems: 'center',
              flexGap: 6,
            }}
          >
            <SvgWidget
              svg={t.mode === 'dark' ? darkMark : lightMark}
              style={{ width: 14, height: 14 }}
            />
            <FlexWidget style={{ flex: 1 }}>
              <TextWidget
                text={shortcuts.header}
                maxLines={1}
                truncate="END"
                style={{
                  fontSize: shortcuts.headerFontSize,
                  fontWeight: 'bold',
                  color: color(t.text),
                }}
              />
              {shortcuts.headerSubtitle ? (
                <TextWidget
                  text={shortcuts.headerSubtitle}
                  maxLines={1}
                  truncate="END"
                  style={{ fontSize: shortcuts.headerFontSize, color: color(t.textSecondary) }}
                />
              ) : null}
            </FlexWidget>
          </FlexWidget>
        ) : null}
        {shortcuts.rows.map((row, i) => (
          <FlexWidget
            key={i}
            style={{
              height: row.height,
              flexDirection: 'row',
              flexGap: shortcuts.gap,
              alignItems: 'center',
            }}
          >
            {row.buttons.map((button) => (
              <FlexWidget
                key={button.id}
                clickAction="OPEN_URI"
                clickActionData={{
                  uri: widgetLink(
                    button.target,
                    __DEV__ ? Constants.expoConfig?.hostUri : undefined,
                  ),
                }}
                accessibilityLabel={button.summary}
                style={{
                  width: button.width,
                  height: 'match_parent',
                  borderRadius: 12,
                  backgroundColor: color(button.primary ? t.brand.bg : t.surfaceMuted),
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingHorizontal: 4,
                }}
              >
                <TextWidget
                  text={button.label}
                  maxLines={1}
                  truncate="END"
                  style={{
                    fontSize: button.fontSize,
                    fontWeight: 'bold',
                    color: color(button.primary ? t.brand.main : t.text),
                  }}
                />
              </FlexWidget>
            ))}
          </FlexWidget>
        ))}
      </FlexWidget>
    );
  }
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{
        uri: widgetLink(view.target, __DEV__ ? Constants.expoConfig?.hostUri : undefined),
      }}
      accessibilityLabel={view.summary}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: l.padding,
        borderRadius: 24,
        backgroundColor: color(t.surface),
        flexDirection: l.compact ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        flexGap: l.gap,
      }}
    >
      <FlexWidget
        style={{
          width: l.tileSize,
          height: l.tileSize,
          borderRadius: 16,
          backgroundColor: color(
            l.tileTone === 'brand'
              ? t.brand.bg
              : l.tileTone === 'muted'
                ? t.surfaceMuted
                : t.surface,
          ),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SvgWidget svg={icon} style={{ width: l.glyphSize, height: l.glyphSize }} />
      </FlexWidget>
      {l.showTitle || l.showSubtitle ? (
        <FlexWidget style={{ ...(l.compact ? {} : { flex: 1 }), flexGap: 0 }}>
          {l.showTitle
            ? l.titleLines.map((line, i) => (
                <TextWidget
                  key={i}
                  text={line}
                  maxLines={1}
                  truncate="END"
                  style={{
                    height: l.titleLineHeight,
                    fontSize: l.titleFontSize,
                    fontWeight: 'bold',
                    fontFamily: 'Outfit',
                    color: color(t.text),
                    ...(l.compact ? { textAlign: 'center' as const } : {}),
                  }}
                />
              ))
            : null}
          {l.showSubtitle ? (
            <FlexWidget style={{ marginTop: 4 }}>
              {l.subtitleLines.map((line, i) => (
                <TextWidget
                  key={i}
                  text={line}
                  maxLines={l.subtitleMaxLines}
                  truncate="END"
                  style={{
                    height: l.subtitleLineHeight,
                    fontSize: l.subtitleFontSize,
                    fontFamily: 'Outfit',
                    color: color(t.textSecondary),
                  }}
                />
              ))}
            </FlexWidget>
          ) : null}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}
