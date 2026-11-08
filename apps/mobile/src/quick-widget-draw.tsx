import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import { quickWidget, type QuickWidgetSetup } from '@splitbook/shared/quick-widget';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';
import type { SemanticTokens } from '@splitbook/shared/design-tokens';
import { widgetLink } from './widget-links';
import Constants from 'expo-constants';
import lightMark from '../assets/widgets/mark-light.svg';
import darkMark from '../assets/widgets/mark-dark.svg';
import quickLight from '../assets/widgets/quick-tile-light.svg';
import quickDark from '../assets/widgets/quick-tile-dark.svg';
export function drawQuick(
  copy: WidgetCopy | null,
  setup: QuickWidgetSetup,
  size: '1x1' | '2x1',
  session: WidgetSession,
  t: SemanticTokens,
  fontScale = 1,
) {
  const view = quickWidget(copy, setup, size, session, fontScale),
    compactState = size === '1x1' && view.state !== 'normal',
    color = (v: string) => v as `#${string}`;
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
        padding: compactState ? 6 : 10,
        borderRadius: 24,
        backgroundColor: color(t.surface),
        flexDirection: compactState ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        flexGap: compactState ? 4 : 10,
      }}
    >
      {view.layout.showTile ? (
        view.state === 'normal' ? (
          <SvgWidget
            svg={t.mode === 'dark' ? quickDark : quickLight}
            style={{ width: 48, height: 48 }}
          />
        ) : (
          <FlexWidget
            style={{
              width: 48,
              height: 48,
              borderRadius: 16,
              backgroundColor: color(view.state === 'signed-out' ? t.brand.bg : t.surfaceMuted),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {view.state === 'signed-out' ? (
              <SvgWidget
                svg={t.mode === 'dark' ? darkMark : lightMark}
                style={{ width: 30, height: 30 }}
              />
            ) : (
              <SvgWidget
                svg={`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="${t.textSecondary}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${view.state === 'expired' ? '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>' : view.state === 'archived' ? '<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>' : view.state === 'other-account' ? '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>'}</g></svg>`}
                style={{ width: 24, height: 24 }}
              />
            )}
          </FlexWidget>
        )
      ) : null}
      {view.layout.showTitle || view.layout.showSubtitle ? (
        <FlexWidget style={{ flex: 1, flexGap: compactState ? 2 : 4 }}>
          {view.layout.showTitle ? (
            <TextWidget
              text={view.title}
              style={{
                fontSize: compactState ? 10 : 12,
                fontWeight: 'bold',
                color: color(t.text),
                ...(compactState ? { textAlign: 'center' as const } : {}),
              }}
            />
          ) : null}
          {view.subtitle && view.layout.showSubtitle ? (
            <TextWidget
              text={view.subtitle}
              maxLines={view.layout.subtitleMaxLines}
              truncate="END"
              style={{
                fontSize: compactState ? 9 : 10,
                width: 'match_parent',
                color: color(t.textSecondary),
                ...(compactState ? { textAlign: 'center' as const } : {}),
              }}
            />
          ) : null}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}
