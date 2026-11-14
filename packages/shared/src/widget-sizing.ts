export interface WidgetDimensions {
  width: number;
  height: number;
  /** Native density; omission measures on a 1 dp pixel grid. */
  pixelRatio?: number;
}
export interface WidgetSection {
  id: string;
  rows: number;
  maxRows?: number;
  /** Minimum dp for one row, including scaled text and fixed padding. */
  rowHeight: number;
  inset?: number;
  /** Minimum height of the whole section, e.g. a fixed column beside a variable list. */
  minHeight?: number;
  moreHeight?: number;
  required?: boolean;
  grow?: boolean;
  /** A lower-priority prompt is admitted only after this list is complete. */
  whenComplete?: string;
  /** Admit a later section after this many rows of an earlier list, or its complete short list. */
  afterRows?: { id: string; rows: number };
}

/** Input order admits sections; rounds expand admitted lists. Overflow hints belong to
 * their section, including a hint alone when no row fits. Required overflow is explicit. */
const nonNegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

export function fitWidgetSections(
  height: number,
  sections: readonly WidgetSection[],
  gap = 8,
  pixelRatio = 1,
) {
  const ratio = nonNegative(pixelRatio) || 1;
  const up = (dp: number) => Math.ceil(nonNegative(dp) * ratio - 1e-9);
  height = Math.floor(nonNegative(height) * ratio + 1e-9);
  gap = up(gap);
  sections = sections.map((s) => ({
    ...s,
    rows: Math.min(Number.MAX_SAFE_INTEGER, Math.floor(nonNegative(s.rows))),
    maxRows: Math.min(
      Math.floor(nonNegative(s.rows)),
      s.maxRows === undefined ? Number.MAX_SAFE_INTEGER : Math.floor(nonNegative(s.maxRows)),
    ),
    rowHeight: Math.max(1, up(s.rowHeight)),
    inset: up(s.inset ?? 0),
    minHeight: up(s.minHeight ?? 0),
    moreHeight: s.moreHeight === undefined ? undefined : up(s.moreHeight),
  }));
  const chosen = sections.map((s) => (s.required ? s.rows : 0));
  const visible = sections.map((s) => !!s.required && s.rows > 0);
  const hasHint = (i: number) =>
    chosen[i] < sections[i].rows && sections[i].moreHeight !== undefined;
  const hint = (i: number) => (chosen[i] < sections[i].rows ? (sections[i].moreHeight ?? 0) : 0);
  const cost = (i: number) =>
    visible[i]
      ? Math.max(
          chosen[i] * sections[i].rowHeight + (chosen[i] ? (sections[i].inset ?? 0) : 0) + hint(i),
          sections[i].minHeight ?? 0,
        )
      : 0;
  const used = () =>
    sections.reduce((sum, _, i) => sum + cost(i), 0) +
    Math.max(0, visible.filter(Boolean).length - 1) * gap;
  const tryRows = (i: number, rows: number) => {
    const previous = chosen[i];
    chosen[i] = rows;
    if (used() <= height) return true;
    chosen[i] = previous;
    return false;
  };
  for (const [i, section] of sections.entries()) {
    if (section.required || !section.rows || section.whenComplete || section.afterRows) continue;
    visible[i] = true;
    // All rows can be cheaper than one row plus a tall hint. Do not reject that fit.
    const cap = section.maxRows ?? section.rows;
    if (
      (cap > 0 && (tryRows(i, 1) || tryRows(i, cap))) ||
      (section.moreHeight !== undefined && tryRows(i, 0))
    )
      continue;
    visible[i] = false;
    break;
  }
  let added = true;
  while (added) {
    added = false;
    for (const [i, section] of sections.entries()) {
      if (section.afterRows && !visible[i] && section.rows) {
        const target = sections.findIndex((s) => s.id === section.afterRows!.id);
        if (
          target >= 0 &&
          visible[target] &&
          chosen[target] >= Math.min(sections[target].rows, section.afterRows.rows)
        ) {
          visible[i] = true;
          const cap = section.maxRows ?? section.rows;
          if (
            (cap > 0 && (tryRows(i, 1) || tryRows(i, cap))) ||
            (section.moreHeight !== undefined && tryRows(i, 0))
          )
            added = true;
          else visible[i] = false;
        }
        continue;
      }
      if (
        section.required ||
        section.whenComplete ||
        !visible[i] ||
        chosen[i] >= (section.maxRows ?? section.rows)
      )
        continue;
      if (tryRows(i, chosen[i] + 1) || tryRows(i, section.maxRows ?? section.rows)) added = true;
    }
  }
  for (const [i, section] of sections.entries()) {
    if (!section.whenComplete || !section.rows) continue;
    const target = sections.findIndex((s) => s.id === section.whenComplete);
    if (target < 0 || chosen[target] !== sections[target].rows) continue;
    visible[i] = true;
    if (!tryRows(i, section.rows)) visible[i] = false;
  }
  const overflow = Math.max(0, used() - height),
    spare = Math.max(0, height - used());
  const explicit = sections.some((s, i) => s.grow && chosen[i] > 0);
  const first = chosen.findIndex((rows) => rows > 0);
  const grows = (i: number) => (explicit ? !!sections[i].grow : i === first);
  const growing = sections.reduce((sum, _, i) => sum + (grows(i) ? chosen[i] : 0), 0);
  let remainder = spare;
  const extras = sections.map((_, i) => {
    const extra = grows(i) && growing ? Math.floor((spare * chosen[i]) / growing) : 0;
    remainder -= extra;
    return extra;
  });
  const recipient = sections.findIndex((_, i) => grows(i) && chosen[i] > 0);
  if (recipient >= 0) extras[recipient] += remainder;
  return {
    fits: overflow === 0,
    overflow: overflow / ratio,
    gap: gap / ratio,
    sections: sections.flatMap((section, i) =>
      visible[i]
        ? [
            {
              id: section.id,
              rows: chosen[i],
              more: hasHint(i) ? section.rows - chosen[i] : 0,
              moreHeight: hint(i) / ratio,
              height: (cost(i) + extras[i]) / ratio,
              rowHeight:
                (section.rowHeight + (chosen[i] ? Math.floor(extras[i] / chosen[i]) : 0)) / ratio,
            },
          ]
        : [],
    ),
  };
}

/** The same conservative glyph estimate is used for wrapping, fitting and row height.
 * Proportional labels do not have the fixed width of mono money. */
function createWidgetText(width: number, scale = 1, factor = 1, pixelRatio = 1) {
  let narrowing = 0;
  width = nonNegative(width);
  scale = nonNegative(scale) || 1;
  factor = nonNegative(factor) || 1;
  pixelRatio = nonNegative(pixelRatio) || 1;
  const font = (base: number) => Math.max(Math.min(base, 10), base * factor);
  const measure = (value: string, base: number, mono = false) =>
    [...value].reduce(
      (sum, c) =>
        sum +
        (mono
          ? 0.6
          : /\s/.test(c)
            ? 0.28
            : /[ilI.,:;'!|]/.test(c)
              ? 0.28
              : /[mwMW@%]/.test(c)
                ? 0.85
                : /[A-Z₹€$£¥]/.test(c)
                  ? 0.65
                  : /[0-9]/.test(c)
                    ? 0.6
                    : c === '＋'
                      ? 0.8
                      : 0.54),
      0,
    ) *
    font(base) *
    scale;
  const text = {
    factor,
    scale,
    font,
    line: (base: number) => Math.ceil(font(base) * scale * 1.3 * pixelRatio - 1e-9) / pixelRatio,
    width: measure,
    fit: (value: string, base: number, room = width, mono = false) => {
      const fitted = Math.max(
        Math.min(base, 10),
        Math.min(base, (base * nonNegative(room)) / Math.max(1, measure(value, base, mono))),
      );
      narrowing += font(base) - font(fitted);
      return fitted;
    },
    words: (value: string, base: number, room = width) => {
      const result: string[] = [];
      // A separator belongs to the following word, never stranded at a line end.
      const words = value.trim().split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i++) {
        const word = words[i] === '·' && words[i + 1] ? words[i] + ' ' + words[++i] : words[i];
        const previous = result.at(-1);
        if (previous && measure(previous + ' ' + word, base) <= room)
          result[result.length - 1] = previous + ' ' + word;
        else result.push(word);
      }
      return result;
    },
  };
  return { text, narrowing: () => narrowing };
}
export function widgetText(width: number, scale = 1, factor = 1, pixelRatio = 1) {
  return createWidgetText(width, scale, factor, pixelRatio).text;
}
export type WidgetText = ReturnType<typeof widgetText>;

/** All widgets remove optional content before fitting indispensable type. The caller
 * supplies measured sections, not its own shrink loop. Below the floor overflow stays explicit. */
export function fitWidgetLayout<T extends { sections: readonly WidgetSection[] }>(
  size: WidgetDimensions,
  scale: number,
  make: (text: WidgetText, optional: boolean) => T,
  gap = 8,
) {
  const attempt = (optional: boolean, factor: number) => {
    const measurement = createWidgetText(size.width, scale, factor, size.pixelRatio);
    const { sections, ...settings } = make(measurement.text, optional);
    return {
      layout: {
        ...settings,
        ...fitWidgetSections(size.height, sections, gap, size.pixelRatio),
        textFactor: factor,
      },
      narrowing: measurement.narrowing(),
    };
  };
  let result = attempt(true, 1);
  if (!result.layout.fits || result.narrowing > 0) {
    const essential = attempt(false, 1);
    if (!result.layout.fits || essential.narrowing < result.narrowing - 1e-9) result = essential;
  }
  for (const factor of [0.95, 0.9, 0.85, 0.8]) {
    if (result.layout.fits) break;
    result = attempt(false, factor);
  }
  return result.layout;
}
