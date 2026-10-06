import type { TextStyle } from 'react-native';
import { fonts } from '../theme';

/**
 * Compact surface scale from the approved design reference (docs/design/android-compact).
 * Sizes are dp. Text follows the Android font scale; layout boxes stay fixed.
 */
export const space = { gutter: 16, section: 12, gap: 8 } as const;
export const radius = { tile: 12, card: 14, fab: 16, sheet: 24 } as const;
/** Minimum touch target; controls inside sheets use 44 and extend to 48 with hitSlop. */
export const touch = { min: 48, dense: 44 } as const;
export const denseHitSlop = { top: 2, bottom: 2, left: 2, right: 2 } as const;

export type TextVariant = 'title' | 'heading' | 'body' | 'small' | 'caption' | 'overline';
export const textVariants: Record<TextVariant, TextStyle> = {
  title: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 24 },
  heading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  overline: {
    fontFamily: fonts.semibold,
    fontSize: 11.5,
    lineHeight: 15,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
};

/** Money is always IBM Plex Mono with tabular figures. */
export type MoneySize = 'form' | 'balance' | 'list' | 'table';
export const moneySizes: Record<MoneySize, TextStyle> = {
  form: { fontSize: 32, lineHeight: 35, letterSpacing: -1 },
  balance: { fontSize: 19, lineHeight: 24, letterSpacing: -0.4 },
  list: { fontSize: 15, lineHeight: 20, letterSpacing: -0.3 },
  table: { fontSize: 13, lineHeight: 17, letterSpacing: -0.2 },
};

/** A text style a skeleton line stands in for: a text variant or a money size. */
export type LineKind = TextVariant | MoneySize;

/**
 * The height one line of `kind` takes at this font scale (Android scales line heights with the
 * text), and the thickness of a skeleton bar drawn in it, a little under the font size.
 */
export function lineBox(kind: LineKind, fontScale: number) {
  const style =
    kind in textVariants ? textVariants[kind as TextVariant] : moneySizes[kind as MoneySize];
  const lineHeight = style.lineHeight as number;
  const fontSize = style.fontSize as number;
  return {
    height: lineHeight * fontScale,
    bar: Math.max(6, Math.round(fontSize * fontScale * 0.72)),
  };
}

/** At or above this Android font scale, tile grids and summary stats use one column. */
export const LARGE_TEXT_SCALE = 1.3;
// Android reports the scale as a 32-bit float (130% arrives as 1.2999999523…), so compare
// whole percentages rather than the raw value.
export const isLargeText = (fontScale: number) =>
  Math.round(fontScale * 100) >= Math.round(LARGE_TEXT_SCALE * 100);

/** A downward drag dismisses a sheet (which behaves like Done) when it travels or flings far enough. */
export const SHEET_DISMISS_DISTANCE = 80;
export const SHEET_DISMISS_VELOCITY = 0.8;
export function shouldDismissSheet({ dy, vy }: { dy: number; vy: number }) {
  return dy > SHEET_DISMISS_DISTANCE || (dy > 0 && vy > SHEET_DISMISS_VELOCITY);
}
