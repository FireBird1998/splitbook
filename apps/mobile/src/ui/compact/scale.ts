import { Platform, type TextStyle } from 'react-native';
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

/**
 * Android 14 (API 34) scales text sizes non-linearly from 115%: small sizes by the whole scale,
 * large ones by less, so headings don't outgrow the screen. These are the platform's own tables
 * (FontScaleConverterFactory): the dp each sp size becomes at each scale, interpolated between
 * sizes and between scales; above 100sp, and below 115%, scaling is linear.
 */
const scaledSizes = [8, 10, 12, 14, 18, 20, 24, 30, 100];
const scaleTables: [scale: number, dp: number[]][] = [
  [1.15, [9.2, 11.5, 13.8, 16.4, 19.8, 21.8, 25.2, 30, 100]],
  [1.3, [10.4, 13, 15.6, 18.8, 21.6, 23.6, 26.4, 30, 100]],
  [1.5, [12, 15, 18, 22, 24, 26, 28, 30, 100]],
  [1.8, [14.4, 18, 21.6, 24.4, 27.6, 30.8, 32.8, 34.8, 100]],
  [2, [16, 20, 24, 26, 30, 34, 36, 38, 100]],
];
const between = (a: number, b: number, at: number) => a + (b - a) * at;
/** One table's dp for `sp`: interpolated between its sizes, from 0 below the first. */
function fromTable(dp: number[], sp: number) {
  const index = scaledSizes.findIndex((size) => size >= sp);
  if (index < 0) return (sp * dp[dp.length - 1]!) / scaledSizes[scaledSizes.length - 1]!;
  const [fromSp, toSp] = [index ? scaledSizes[index - 1]! : 0, scaledSizes[index]!];
  const [fromDp, toDp] = [index ? dp[index - 1]! : 0, dp[index]!];
  return between(fromDp, toDp, (sp - fromSp) / (toSp - fromSp));
}

/**
 * How many dp `sp` takes at this font scale, as Android lays text out: linearly before Android
 * 14 and below 115%, by the platform's curves from there. Line heights and font sizes both
 * follow it, so a 35sp amount stays 35dp at 130% while 16sp captions grow to about 20dp.
 */
export function scaledSp(sp: number, fontScale: number) {
  const curved = Platform.OS === 'android' && Number(Platform.Version) >= 34;
  if (!curved || fontScale < scaleTables[0]![0]) return sp * fontScale;
  const above = scaleTables.findIndex(([scale]) => scale >= fontScale);
  // Beyond the largest table Android scales linearly, by the scale itself.
  if (above < 0) return sp * fontScale;
  const [upper, upperDp] = scaleTables[above]!;
  if (upper === fontScale || above === 0) return fromTable(upperDp, sp);
  const [lower, lowerDp] = scaleTables[above - 1]!;
  return between(
    fromTable(lowerDp, sp),
    fromTable(upperDp, sp),
    (fontScale - lower) / (upper - lower),
  );
}

/** A text style a skeleton line stands in for: a text variant or a money size. */
export type LineKind = TextVariant | MoneySize;

/**
 * The height one line of `kind` takes at this font scale (Android scales line heights with the
 * text, by `scaledSp`), and the thickness of a skeleton bar drawn in it, a little under the font
 * size.
 */
export function lineBox(kind: LineKind, fontScale: number) {
  const style =
    kind in textVariants ? textVariants[kind as TextVariant] : moneySizes[kind as MoneySize];
  const lineHeight = style.lineHeight as number;
  const fontSize = style.fontSize as number;
  return {
    height: scaledSp(lineHeight, fontScale),
    bar: Math.max(6, Math.round(scaledSp(fontSize, fontScale) * 0.72)),
  };
}

/** At or above this Android font scale, tile grids use one column. */
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
