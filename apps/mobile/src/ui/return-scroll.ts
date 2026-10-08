import type { ScrollAnchor } from '../data/types';

/** Native layouts in the destination's ScrollView content, never saved on the phone. */
export type RowPlaces = ReadonlyMap<string, { top: number; height: number }>;

/** The first visible row, with the scroll offset measured from its top. */
export function visibleRowAnchor(
  rows: RowPlaces,
  y: number,
  viewport = Infinity,
): ScrollAnchor | undefined {
  const visible = [...rows].filter(
    ([, row]) => row.height > 0 && row.top + row.height > y && row.top < y + viewport,
  );
  visible.sort((a, b) => a[1].top - b[1].top);
  const first = visible[0];
  return first ? { key: first[0], offset: y - first[1].top } : undefined;
}

/**
 * Return to the same row despite new rows or larger text above it. Without that row, the old
 * offset lands at the nearest reachable place. The caller waits for native layouts first.
 */
export function returnScrollTarget(
  restore: { y: number; anchor?: ScrollAnchor },
  rows: RowPlaces,
  view: { content: number; viewport: number },
): number {
  const row = restore.anchor && rows.get(restore.anchor.key);
  const y = row && restore.anchor ? row.top + restore.anchor.offset : restore.y;
  return Math.max(0, Math.min(y, Math.max(0, view.content - view.viewport)));
}
