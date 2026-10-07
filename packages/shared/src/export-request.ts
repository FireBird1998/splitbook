/**
 * The contract of the export read (#317), `GET /api/export`: what a request asks for, how the
 * server reads it, and what the files it sends are called. The web page builds its request and
 * predicts the file names with the same functions the server uses, so the two never disagree.
 *
 * "Period" in the UI is a date window, not the glossary's Month: two calendar days, inclusive,
 * or all time.
 */
import { z } from 'zod';
import { identity } from './wire-fields';

/** What a member can add to an export, in the order a request lists them. */
export const EXPORT_INCLUDES = ['payments', 'shares', 'deleted', 'history'] as const;
export type ExportInclude = (typeof EXPORT_INCLUDES)[number];

/** The formats the read can build. The JSON backup (#318) will add its own. */
export const EXPORT_FORMATS = ['csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The most Groups one request may name. */
export const EXPORT_MAX_GROUPS = 50;

/**
 * The most rows one export may hold, across every file: Expenses (deleted ones too, when
 * asked), edits and payments. A larger export is refused with `EXPORT_TOO_LARGE` rather than
 * built: the files are made in memory, so this keeps one request's memory bounded.
 */
export const EXPORT_MAX_ROWS = 50_000;

/** What the read is asked for, once read and checked. */
export interface ExportRequest {
  /** The Groups to export, in the order asked, without repeats. */
  groupIds: string[];
  /** The window's first and last calendar days (`YYYY-MM-DD`), inclusive; both absent for all time. */
  from?: string;
  to?: string;
  include: ExportInclude[];
  format: ExportFormat;
  /** The viewer's IANA time zone: the calendar a payment's or an edit's time is read in. */
  timeZone: string;
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a string is a real calendar day, `YYYY-MM-DD` (not `2026-02-31`). */
export function isCalendarDay(value: string): boolean {
  const match = CALENDAR_DAY.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Whether this runtime knows the IANA time zone. */
export function isTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A comma-separated query value as its parts, blanks dropped. */
const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const calendarDay = z.string().refine(isCalendarDay, { message: 'Use a real day, YYYY-MM-DD' });

const exportQuery = z
  .object({
    groups: z
      .string({ message: 'Pick at least one Group' })
      .transform(list)
      .pipe(
        z
          .array(identity, { message: 'Unknown Group' })
          .min(1, { message: 'Pick at least one Group' })
          .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))])
          .pipe(
            z.array(z.string()).max(EXPORT_MAX_GROUPS, {
              message: `Export at most ${EXPORT_MAX_GROUPS} Groups at once`,
            }),
          ),
      ),
    from: calendarDay.optional(),
    to: calendarDay.optional(),
    include: z
      .string()
      .optional()
      .transform(list)
      .pipe(z.array(z.enum(EXPORT_INCLUDES))),
    format: z.enum(EXPORT_FORMATS).default('csv'),
    tz: z.string().refine(isTimeZone, { message: 'Unknown time zone' }).default('UTC'),
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: 'Give both from and to, or neither for all time',
    path: ['to'],
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'The window ends before it starts',
    path: ['to'],
  });

/** Anything a query value can be read from, such as `URLSearchParams`. */
export interface QueryValues {
  get(name: string): string | null;
}

/**
 * Read an export request's query. Each include is named once, in `EXPORT_INCLUDES` order, so
 * two requests that ask for the same thing are read the same way.
 */
export function parseExportQuery(values: QueryValues) {
  const value = (name: string) => values.get(name) ?? undefined;
  const parsed = exportQuery.safeParse({
    groups: value('groups'),
    from: value('from') || undefined,
    to: value('to') || undefined,
    include: value('include'),
    format: value('format') || undefined,
    tz: value('tz') || undefined,
  });
  if (!parsed.success) return parsed;
  const { groups, from, to, include, format, tz } = parsed.data;
  const request: ExportRequest = {
    groupIds: groups,
    ...(from && to ? { from, to } : {}),
    include: EXPORT_INCLUDES.filter((name) => include.includes(name)),
    format,
    timeZone: tz,
  };
  return { success: true as const, data: request };
}

// ─── Windows ────────────────────────────────────────────

const pad = (value: number) => String(value).padStart(2, '0');

/** The calendar day of a local date, `YYYY-MM-DD`, as the device's own calendar has it. */
export function localCalendarDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A whole calendar month as a window: its first and last days. `month` counts from 1. */
export function monthWindow(year: number, month: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

/**
 * The window's part of a file name: `2026-09` for a whole month, `2026-09-14` for one day,
 * `2026-09-01-to-2026-09-15` for any other window, and `all-time` without one.
 */
export function exportWindowSlug({ from, to }: { from?: string; to?: string }): string {
  if (!from || !to) return 'all-time';
  if (from === to) return from;
  const [year, month] = from.split('-').map(Number);
  const whole = monthWindow(year, month);
  if (whole.from === from && whole.to === to) return from.slice(0, 7);
  return `${from}-to-${to}`;
}

// ─── File names ─────────────────────────────────────────

/** The kinds of CSV an export holds for each Group. */
export type ExportFileKind = 'expenses' | 'payments';

const SLUG_LIMIT = 48;

/**
 * A Group's name as it appears in a file name: lower case ASCII letters, digits and hyphens,
 * accents folded ("Café Crew" → `cafe-crew`). A name with nothing left becomes `group`.
 */
export function exportSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LIMIT)
    .replace(/-+$/, '');
  return slug || 'group';
}

export interface ExportFile {
  /** The Group's position in the request. */
  group: number;
  kind: ExportFileKind;
  name: string;
}

export interface ExportFilePlan {
  /** Every CSV, Group by Group, Expenses before payments. */
  files: ExportFile[];
  /** What the browser saves: the one CSV, or the zip holding them all. */
  download: string;
  zipped: boolean;
}

/**
 * The files an export holds and the name it downloads under. Each Group has an Expenses CSV,
 * and a payments CSV when payments are included: `<group>-<window>-expenses.csv`. One file
 * downloads as itself; several download as one zip, named after the Group, or
 * `splitbook-<n>-groups-<window>.zip` for several Groups. Two Groups with the same name are
 * told apart as `-2`, `-3`, in request order.
 */
export function planExportFiles(
  groupNames: readonly string[],
  { from, to, include }: Pick<ExportRequest, 'from' | 'to' | 'include'>,
): ExportFilePlan {
  const window = exportWindowSlug({ from, to });
  const used = new Set<string>();
  const slugs = groupNames.map((name) => {
    const base = exportSlug(name);
    let slug = base;
    for (let count = 2; used.has(slug); count += 1) slug = `${base}-${count}`;
    used.add(slug);
    return slug;
  });
  const kinds: ExportFileKind[] = include.includes('payments')
    ? ['expenses', 'payments']
    : ['expenses'];
  const files = slugs.flatMap((slug, group) =>
    kinds.map((kind) => ({ group, kind, name: `${slug}-${window}-${kind}.csv` })),
  );
  if (files.length === 1) return { files, download: files[0].name, zipped: false };
  const download =
    slugs.length === 1
      ? `${slugs[0]}-${window}.zip`
      : `splitbook-${slugs.length}-groups-${window}.zip`;
  return { files, download, zipped: true };
}
