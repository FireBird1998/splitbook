import { overviewWidget, type OverviewSetup } from '@splitbook/shared/overview-widget';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';

/** Actual Pixel launcher bounds for the original Balances placements. */
export function overviewAt(
  copy: WidgetCopy | null,
  setup: Omit<OverviewSetup, 'widgetId'>,
  size: '2x1' | '2x2' | '4x2',
  session: WidgetSession,
  now: number,
  scale = 1,
) {
  const dimensions = {
    '2x1': { width: 172, height: 104 },
    '2x2': { width: 172, height: 224 },
    '4x2': { width: 360, height: 224 },
  };
  return overviewWidget(copy, { widgetId: 7, ...setup }, dimensions[size], session, now, scale);
}
