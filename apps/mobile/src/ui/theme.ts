import { createContext, useContext } from 'react';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';

export const ThemeContext = createContext(getSemanticTokens('light'));
export const useTheme = () => useContext(ThemeContext);
export const fonts = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semibold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
  mono: 'IBMPlexMono_500Medium',
} as const;
