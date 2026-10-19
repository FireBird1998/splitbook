import { Image } from 'react-native';
import light from '../../assets/brand/logo-light.png';
import dark from '../../assets/brand/logo-dark.png';

export const brandLogoSize = { width: 124.25, height: 32 } as const;

/** The canonical 497 × 128 lockup, held at 32 dp regardless of system text size. */
export function brandLogo(mode: 'light' | 'dark', heading = false) {
  return (
    <Image
      source={mode === 'dark' ? dark : light}
      accessible
      accessibilityLabel="Splitbook"
      accessibilityRole={heading ? 'header' : 'image'}
      resizeMode="contain"
      style={{ ...brandLogoSize, flexShrink: 0 }}
    />
  );
}
