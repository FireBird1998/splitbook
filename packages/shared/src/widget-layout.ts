import type { BalancesWidgetSize } from './balances-widget';
import type { GroupWidgetSize } from './group-widget';
/** A widget gives up optional lines before it gives up readable type. */
export function widgetTextLevel(scale: number) {
  return scale >= 2 ? 2 : scale >= 1.3 ? 1 : 0;
}
export function balancesLayout(size: BalancesWidgetSize, scale: number, normal: boolean) {
  const level = widgetTextLevel(scale),
    small = size === '2x1';
  return {
    currencyLines: size === '4x2' ? [3, 2, 1][level]! : size === '2x2' && !level ? 2 : 1,
    showReview: !level && !small,
    showHeader: !small || normal,
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
export function groupLayout(size: GroupWidgetSize, scale: number) {
  const level = widgetTextLevel(scale),
    small = size === '2x2';
  return {
    paymentLines: small ? 0 : size === '4x3' ? [4, 2, 1][level]! : [2, 1, 0][level]!,
    showDescription: level < 2 && (!small || !level),
    showTile: level < 2,
    showPeople: level < 2,
    showSaved: true,
    stackPayments: level === 2,
    stackHeader: level > 0,
    moneyFontSize: level === 2 ? 13 : 18,
  };
}
export function quickLayout(size: '1x1' | '2x1', scale: number, normal: boolean) {
  const level = widgetTextLevel(scale),
    small = size === '1x1';
  return {
    showTitle: small ? !normal && !level : normal ? level < 2 : true,
    showSubtitle: !small && (normal || !level),
    showTile: small || normal || level < 2,
    subtitleMaxLines: 2,
  };
}
