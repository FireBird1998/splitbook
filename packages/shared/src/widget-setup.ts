import type { QuickWidgetSetup } from './quick-widget';

import type { PersonWidgetSetup } from './person-widget';
import type { GroupWidgetSetup } from './group-widget';
export type WidgetSetupRecord =
  | PersonWidgetSetup
  | GroupWidgetSetup
  | { kind: 'balances'; widgetId: number; hideAmounts?: boolean }
  | QuickWidgetSetup;
/** Stored choices keep first-chosen order; malformed entries supply no Tags. */
export function readWidgetTagIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string'))].slice(0, 4)
    : [];
}
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
          ? 'groupId' in current
            ? current.groupId
            : null
          : kind === 'quick'
            ? null
            : firstGroupId,
    ...(current?.kind === 'quick' && current.accountId === accountId && current.mode === 'payment'
      ? { mode: 'payment' as const }
      : {}),
    ...(current?.kind === 'quick' && current.accountId === accountId && current.tagIds !== undefined
      ? {
          tagIds: readWidgetTagIds(current.tagIds),
        }
      : {}),
    hideAmounts: current && 'hideAmounts' in current ? current.hideAmounts === true : false,
    ...(kind === 'group'
      ? {
          showRecentExpenses:
            current?.kind === 'group' &&
            current.accountId === accountId &&
            current.showRecentExpenses === true,
        }
      : {}),
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
