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

/** Priority is input order. Admit each section before expanding its rows, then share spare
 * height between the rows already present. Callers measure text at the phone's font scale. */
export function fitWidgetSections(height: number, sections: readonly WidgetSection[], gap = 8) {
  const chosen = sections.map((section) => (section.required ? section.rows : 0));
  const cost = (index: number) => {
    const section = sections[index],
      rows = chosen[index];
    return rows
      ? rows * section.rowHeight +
          (section.inset ?? 0) +
          (rows < section.rows ? (section.moreHeight ?? 0) : 0)
      : 0;
  };
  const used = () => {
    const heights = sections.map((_, index) => cost(index)).filter(Boolean);
    return heights.reduce((sum, value) => sum + value, 0) + Math.max(0, heights.length - 1) * gap;
  };
  for (const [index, section] of sections.entries()) {
    if (section.required || !section.rows) continue;
    chosen[index] = 1;
    if (used() > height) {
      chosen[index] = 0;
      break;
    }
  }
  for (const [index, section] of sections.entries()) {
    if (section.required || !chosen[index]) continue;
    while (chosen[index] < section.rows) {
      chosen[index]++;
      if (used() > height) {
        chosen[index]--;
        break;
      }
    }
  }
  const spare = Math.max(0, height - used());
  const first = chosen.findIndex((rows) => rows > 0);
  const grows = (index: number) =>
    sections.some((s, i) => s.grow && chosen[i]) ? !!sections[index].grow : index === first;
  const growing = sections.reduce(
    (sum, section, index) => sum + (grows(index) ? chosen[index] : 0),
    0,
  );
  const last = chosen.reduce((last, rows, index) => (rows > 0 ? index : last), -1);
  return {
    fits: used() <= height,
    overflow: Math.max(0, used() - height),
    gap,
    sections: sections.flatMap((section, index) =>
      chosen[index]
        ? [
            {
              id: section.id,
              rows: chosen[index],
              more: section.rows - chosen[index],
              height:
                cost(index) +
                (growing
                  ? grows(index)
                    ? (spare * chosen[index]) / growing
                    : 0
                  : index === last
                    ? spare
                    : 0),
              rowHeight: section.rowHeight + (grows(index) && growing ? spare / growing : 0),
            },
          ]
        : [],
    ),
  };
}
