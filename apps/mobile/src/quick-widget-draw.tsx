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
export function drawQuick(
  copy: WidgetCopy | null,
  setup: QuickWidgetSetup,
  size: '1x1' | '2x1',
  session: WidgetSession,
  t: SemanticTokens,
) {
  const view = quickWidget(copy, setup, size, session),
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
        padding: 12,
        borderRadius: 24,
        backgroundColor: color(t.surface),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        flexGap: 10,
      }}
    >
      {view.state === 'normal' ? (
        <FlexWidget
          style={{
            backgroundColor: color(size === '2x1' ? t.brand.bg : t.surface),
            padding: 7,
            borderRadius: 14,
          }}
        >
          <SvgWidget
            svg={t.mode === 'dark' ? darkMark : lightMark}
            style={{ width: 30, height: 30 }}
          />
          <TextWidget
            text="＋"
            style={{
              fontSize: 15,
              fontWeight: 'bold',
              color: color(t.brand.main),
              textAlign: 'right',
            }}
          />
        </FlexWidget>
      ) : null}
      {size === '2x1' || view.state !== 'normal' ? (
        <FlexWidget style={{ flex: 1, flexGap: 4 }}>
          <TextWidget
            text={view.title}
            style={{ fontSize: 12, fontWeight: 'bold', color: color(t.text) }}
          />
          {view.subtitle ? (
            <TextWidget
              text={view.subtitle}
              style={{ fontSize: 10, color: color(t.textSecondary) }}
            />
          ) : null}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}
