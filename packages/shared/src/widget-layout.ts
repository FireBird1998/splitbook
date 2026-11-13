import type { BalancesWidgetSize } from './balances-widget';
/** A widget gives up optional lines before it gives up readable type. */
export function widgetTextLevel(scale: number) {
  const percent = Math.round(scale * 100);
  return percent >= 200 ? 2 : percent >= 130 ? 1 : 0;
}
export function balancesLayout(
  size: BalancesWidgetSize,
  scale: number,
  normal: boolean,
  hidden = false,
) {
  const level = widgetTextLevel(scale),
    small = size === '2x1';
  return {
    equalColumns: small || size === '4x2',
    currencyLines: size === '4x2' ? [3, 2, 1][level]! : size === '2x2' && !level ? 2 : 1,
    showReview: !level && !small,
    showHeader: (!small || normal) && !(small && level > 0 && normal),
    showPrivacyLabel:
      size === '4x2' || (small && hidden && level > 0) || (level < 2 && (!small || !level)),
    hiddenFontSize: small && level === 2 ? 8 : 11,
    privacyFontSize: small && hidden && level === 2 ? 8 : 10,
    showTile: !small && level < 2,
    showDescription: small || level < 2,
    showSavedInHeader: !level,
    showSavedInFooter: !!level && !small,
    showOverflow: !level || (!small && level < 2),
    showSecondary: !small || !level,
    moneyFontSize: level === 2 ? 13 : small ? 19 : 16,
    stateTitleSize: small ? (level === 2 ? 10 : 12) : 14,
  };
}
