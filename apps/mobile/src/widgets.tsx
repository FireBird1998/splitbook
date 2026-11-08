// Narrow imports keep unused preview and setup UI out of the widget bundle.
import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import { registerWidgetTaskHandler } from 'react-native-android-widget/src/api/register-widget-task-handler';
import lightMark from '../assets/widgets/mark-light.svg';
import darkMark from '../assets/widgets/mark-dark.svg';
import { lightTokens, darkTokens, type SemanticTokens } from '@splitbook/shared/design-tokens';

const color = (value: string) => value as `#${string}`;

function emptyBalances(tokens: SemanticTokens) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="Balances. Nothing saved yet. Open Splitbook to load."
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: 14,
        backgroundColor: color(tokens.surface),
        borderRadius: 24,
        justifyContent: 'space-between',
      }}
    >
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        <SvgWidget
          svg={tokens.mode === 'dark' ? darkMark : lightMark}
          style={{ width: 20, height: 20, marginRight: 8 }}
        />
        <TextWidget
          text="Balances"
          style={{ color: color(tokens.text), fontSize: 12, fontWeight: 'bold' }}
        />
      </FlexWidget>
      <FlexWidget>
        <TextWidget
          text="Nothing saved yet"
          style={{ color: color(tokens.text), fontSize: 14, fontWeight: 'bold' }}
        />
        <TextWidget
          text="Open Splitbook to load"
          style={{ color: color(tokens.textSecondary), fontSize: 12, marginTop: 6 }}
        />
      </FlexWidget>
      <FlexWidget style={{ height: 12 }} />
    </FlexWidget>
  );
}

export function registerAndroidWidgets() {
  registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
    if (widgetInfo.widgetName !== 'Balances' || widgetAction === 'WIDGET_DELETED') return;
    renderWidget({ light: emptyBalances(lightTokens), dark: emptyBalances(darkTokens) });
  });
}
