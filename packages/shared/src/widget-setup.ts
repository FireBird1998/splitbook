import type { GroupWidgetSetup } from './group-widget';
export type WidgetSetupRecord =
  | GroupWidgetSetup
  | { kind: 'balances'; widgetId: number; hideAmounts?: boolean }
  // The Add expense provider lands separately. Keep its current target at this setup seam.
  | { kind: 'quick'; widgetId: number; accountId: string; groupId: string | null };
export function widgetSetupChoices(
  kind: WidgetSetupRecord['kind'],
  saved: WidgetSetupRecord | null,
  accountId: string | null,
  firstGroupId: string | null,
) {
  const current = saved?.kind === kind ? saved : null;
  return {
    groupId:
      kind === 'balances'
        ? null
        : current && 'accountId' in current && current.accountId === accountId
          ? current.groupId
          : kind === 'quick'
            ? null
            : firstGroupId,
    hideAmounts: current && 'hideAmounts' in current ? current.hideAmounts === true : false,
  };
}
/** A saved setup belongs to an already placed widget, including one from another account. */
export function widgetSetupButtonLabel(saved: WidgetSetupRecord | null) {
  return saved ? 'Save' : 'Add widget';
}
/** An update of a pre-setup Balances widget creates its default device preference. */
export function legacyBalancesSetup(
  action: string,
  widgetId: number,
  saved: WidgetSetupRecord | null,
  stillPlaced = true,
): WidgetSetupRecord | null {
  return stillPlaced && action === 'WIDGET_UPDATE' && !saved
    ? { kind: 'balances', widgetId, hideAmounts: false }
    : null;
}
