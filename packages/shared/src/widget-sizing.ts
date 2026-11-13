export interface WidgetDimensions {
  width: number;
  height: number;
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
export function fitWidgetSections(height: number, sections: readonly WidgetSection[], gap = 8) {
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
  return {
    fits: overflow === 0,
    overflow,
    gap,
    sections: sections.flatMap((section, i) => visible[i] ? [{
      id: section.id,
      rows: chosen[i],
      more: hint(i) ? section.rows - chosen[i] : 0,
      moreHeight: hint(i),
      height: cost(i) + (grows(i) && growing ? spare * chosen[i] / growing : 0),
      rowHeight: section.rowHeight + (grows(i) && growing ? spare / growing : 0),
    }] : []),
  };
}
