import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import type { widgetSetupRequired } from '@splitbook/shared/widget-setup';
import type { SemanticTokens } from '@splitbook/shared/design-tokens';
import Constants from 'expo-constants';
import { widgetLink } from './widget-links';

/** The same measured, non-personal replacement for all four widget kinds. */
export function drawWidgetSetup(view: ReturnType<typeof widgetSetupRequired>, t: SemanticTokens) {
  return (
    <FlexWidget
      accessibilityLabel={view.title}
      clickAction="OPEN_URI"
      clickActionData={{
        uri: widgetLink(view.target, __DEV__ ? Constants.expoConfig?.hostUri : undefined),
      }}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        padding: view.padding,
        justifyContent: 'center',
        backgroundColor: t.bg as `#${string}`,
        borderRadius: 16,
      }}
    >
      {view.layout.lines.map((line, index) => (
        <TextWidget
          key={index}
          text={line}
          maxLines={1}
          truncate="END"
          style={{
            color: t.text as `#${string}`,
            fontSize: view.layout.fontSize,
            fontWeight: 'bold',
          }}
        />
      ))}
    </FlexWidget>
  );
}
