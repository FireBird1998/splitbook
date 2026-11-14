import { SvgWidget } from 'react-native-android-widget/src/widgets/SvgWidget';
import type { GroupCategory } from '@splitbook/shared/types';

/** The same Theme drawing in Group headers and Overview rows. */
export function widgetThemeIcon(theme: GroupCategory | null, ink: string) {
  const path =
    theme === 'home'
      ? 'M3 11L12 3l9 8M6 10v11h12V10M10 21v-7h4v7'
      : theme === 'trip'
        ? 'M12 2v20M3 13l9-5 9 5v3l-9-3-9 3zM8 21l4-3 4 3'
        : theme === 'work'
          ? 'M3 8h18v13H3zM8 8V3h8v5M3 13h18'
          : theme === 'couple'
            ? 'M12 21L3 12C-2 3 8 0 12 6C16 0 26 3 21 12z'
            : 'M3 21v-4a5 5 0 0110 0v4M8 11a4 4 0 100-8 4 4 0 000 8M15 4a4 4 0 010 8M16 16a5 5 0 015 5';
  return (
    <SvgWidget
      svg={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="${path}" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`}
      style={{ width: 20, height: 20 }}
    />
  );
}
