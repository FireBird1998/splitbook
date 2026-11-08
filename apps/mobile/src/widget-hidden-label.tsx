import { FlexWidget } from 'react-native-android-widget/src/widgets/FlexWidget';
import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import { TextWidget } from 'react-native-android-widget/src/widgets/TextWidget';
import type { SemanticTokens } from '@splitbook/shared/design-tokens';
/** The same quiet privacy indicator on Balances and Group. */
export function hiddenLabel(label: string, t: SemanticTokens) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 4 }}>
      <SvgWidget
        svg={`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="${t.textMuted}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 4.4 9 7-.2.9-1 2.2-2 3.3M6.3 6.3C4.4 7.8 3.2 10 3 12c.5 2.6 4 7 9 7 1.7 0 3.2-.5 4.5-1.3"/></g></svg>`}
        style={{ width: 14, height: 14 }}
      />
      <TextWidget text={label} style={{ fontSize: 10, color: t.textMuted as `#${string}` }} />
    </FlexWidget>
  );
}
