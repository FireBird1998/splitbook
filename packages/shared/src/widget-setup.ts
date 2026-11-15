import type { QuickWidgetSetup } from './quick-widget';

import type { PersonWidgetSetup } from './person-widget';
import type { GroupWidgetSetup } from './group-widget';
import { fitWidgetLayout, type WidgetDimensions } from './widget-sizing';
export type WidgetSetupRecord =
  | PersonWidgetSetup
  | GroupWidgetSetup
  | { kind: 'balances'; widgetId: number; hideAmounts?: boolean }
  | QuickWidgetSetup;

/** One account-neutral message for a damaged placement, for every widget kind. */
export function widgetSetupRequired(widgetId: number, size: WidgetDimensions, fontScale = 1) {
  const title = 'Set up this widget again';
  const padding = 8;
  const bounds = {
    ...size,
    width: Math.max(0, size.width - padding * 2),
    height: Math.max(0, size.height - padding * 2),
  };
  const layout = fitWidgetLayout(
    bounds,
    fontScale,
    (text) => {
      const font = text.fit(title, 20, bounds.width * 2);
      const lines = text.words(title, font);
      return {
        lines,
        fontSize: text.font(font),
        sections: [
          { id: 'message', rows: lines.length, rowHeight: text.line(font), required: true },
        ],
      };
    },
    0,
  );
  return { title, padding, layout, target: { kind: 'setup' as const, widgetId } };
}
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
