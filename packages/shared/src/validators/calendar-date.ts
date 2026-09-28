import { z } from 'zod/v4';

const ISO_DAY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:$|[Tt\s])/;

/** False only for ISO-looking strings whose day does not exist, e.g. `2026-02-31`. */
function hasRealCalendarDay(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const match = ISO_DAY_PREFIX.exec(value.trim());
  if (!match) return true;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(0);
  // Date.UTC remaps years 0–99 into 1900–1999; this preserves the submitted year.
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * `z.coerce.date()` that refuses impossible days. JavaScript rolls them over
 * (`2026-02-31` becomes March 3), which would silently store a different date.
 */
export const calendarDate = z
  .unknown()
  .refine(hasRealCalendarDay, { message: 'Enter a real calendar date' })
  .pipe(z.coerce.date());
