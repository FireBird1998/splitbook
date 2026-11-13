export interface WidgetDimensions {
  width: number;
  height: number;
  /** Native density; omission measures on a 1 dp pixel grid. */
  pixelRatio?: number;
}
export interface WidgetSection {
  id: string;
  rows: number;
  /** Minimum dp for one row, including scaled text and fixed padding. */
  rowHeight: number;
  inset?: number;
  moreHeight?: number;
  required?: boolean;
  grow?: boolean;
}

/** Input order admits sections; rounds expand admitted lists. Overflow hints belong to
 * their section, including a hint alone when no row fits. Required overflow is explicit. */
const nonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

export function fitWidgetSections(
  height: number, sections: readonly WidgetSection[], gap = 8, pixelRatio = 1,
) {
  const ratio = nonNegative(pixelRatio) || 1;
  const up = (dp: number) => Math.ceil(nonNegative(dp) * ratio - 1e-9);
  height = Math.floor(nonNegative(height) * ratio + 1e-9);
  gap = up(gap);
  sections = sections.map((s) => ({ ...s,
    rows: Math.min(Number.MAX_SAFE_INTEGER, Math.floor(nonNegative(s.rows))),
    rowHeight: Math.max(1, up(s.rowHeight)),
    inset: up(s.inset ?? 0), moreHeight: up(s.moreHeight ?? 0),
  }));
  const chosen = sections.map((s) => (s.required ? s.rows : 0));
  const visible = sections.map((s) => !!s.required && s.rows > 0);
  const hint = (i: number) => chosen[i] < sections[i].rows ? sections[i].moreHeight ?? 0 : 0;
  const cost = (i: number) => visible[i]
    ? chosen[i] * sections[i].rowHeight + (chosen[i] ? sections[i].inset ?? 0 : 0) + hint(i)
    : 0;
  const used = () => sections.reduce((sum, _, i) => sum + cost(i), 0) +
    Math.max(0, visible.filter(Boolean).length - 1) * gap;
  const tryRows = (i: number, rows: number) => {
    const previous = chosen[i];
    chosen[i] = rows;
    if (used() <= height) return true;
    chosen[i] = previous;
    return false;
  };
  for (const [i, section] of sections.entries()) {
    if (section.required || !section.rows) continue;
    visible[i] = true;
    // All rows can be cheaper than one row plus a tall hint. Do not reject that fit.
    if (tryRows(i, 1) || tryRows(i, section.rows) || (section.moreHeight && tryRows(i, 0))) continue;
    visible[i] = false;
    break;
  }
  let added = true;
  while (added) {
    added = false;
    for (const [i, section] of sections.entries()) {
      if (section.required || !visible[i] || chosen[i] >= section.rows) continue;
      if (tryRows(i, chosen[i] + 1) || tryRows(i, section.rows)) added = true;
    }
  }
  const overflow = Math.max(0, used() - height), spare = Math.max(0, height - used());
  const explicit = sections.some((s, i) => s.grow && chosen[i] > 0);
  const first = chosen.findIndex((rows) => rows > 0);
  const grows = (i: number) => explicit ? !!sections[i].grow : i === first;
  const growing = sections.reduce((sum, _, i) => sum + (grows(i) ? chosen[i] : 0), 0);
  let remainder = spare;
  const extras = sections.map((_, i) => {
    const extra = grows(i) && growing ? Math.floor(spare * chosen[i] / growing) : 0;
    remainder -= extra;
    return extra;
  });
  const recipient = sections.findIndex((_, i) => grows(i) && chosen[i] > 0);
  if (recipient >= 0) extras[recipient] += remainder;
  return {
    fits: overflow === 0,
    overflow: overflow / ratio,
    gap: gap / ratio,
    sections: sections.flatMap((section, i) => visible[i] ? [{
      id: section.id,
      rows: chosen[i],
      more: hint(i) ? section.rows - chosen[i] : 0,
      moreHeight: hint(i) / ratio,
      height: (cost(i) + extras[i]) / ratio,
      rowHeight: (section.rowHeight + (chosen[i] ? Math.floor(extras[i] / chosen[i]) : 0)) / ratio,
    }] : []),
  };
}
