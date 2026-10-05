/**
 * #206: the render and request ceilings of `src/render-profile.test.tsx` live in one data
 * file, `src/render-profile.ceilings.json`. The harness reads it through `harnessCeilings`,
 * and the ratchet below compares it with the base commit's copy, so nothing parses test code.
 *
 * `pnpm mobile ceilings:compare --base <commit>` compares the working tree's data file with
 * the one at `<commit>`:
 *
 * - lowering a ceiling, adding a journey or adding a measure always passes;
 * - a higher ceiling, a journey removed or renamed, or a measure that lost its ceiling needs
 *   a re-record, which only the owner approves, with the `re-record-ceilings` label.
 *
 * In CI (`--pull-request`, `--repository` and `--owner`, with `GITHUB_TOKEN`) it reads the
 * pull request's timeline, every page of it, and accepts the label only when its latest
 * `labeled` event was made by the owner. Without them, as `pnpm swarm gate` runs it, it
 * reports what would need a re-record and fails.
 *
 * Exit codes: 0 passes, 1 needs the owner's re-record label, 2 could not compare.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

/** The data file, relative to `apps/mobile`. */
export const ceilingsFile = 'src/render-profile.ceilings.json';
/** The label the owner applies to approve a re-record. The owner creates it. */
export const reRecordLabel = 're-record-ceilings';
/** What the harness limits for each journey. */
export const measures = ['requests', 'publishes', 'commits', 'renders'] as const;
export type Measure = (typeof measures)[number];
/** Journey name → measure → ceiling. */
export type Ceilings = Record<string, Record<string, number>>;

const count = z.number().int().nonnegative();
const name = z.string().min(1);
const fileSchema = <Journey extends z.ZodType>(journey: Journey) =>
  z.strictObject({ about: z.string().optional(), journeys: z.record(name, journey) });
/** Any measures: the comparison also reads a base commit's file, which may differ in shape. */
const anyMeasures = fileSchema(z.record(name, count));
/** Exactly the measures the harness checks. */
const harnessMeasures = fileSchema(
  z.strictObject({
    requests: count,
    publishes: count,
    commits: count,
    renders: count,
  } satisfies Record<Measure, typeof count>),
);

function parseFile<Shape extends z.ZodType>(schema: Shape, text: string, source: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new Error(`${source} is not a valid ceilings file:\n${z.prettifyError(parsed.error)}`);
  return parsed.data as z.infer<Shape>;
}

/** The data file's journeys, each with whatever measures it limits. */
export const parseCeilings = (text: string, source: string): Ceilings =>
  parseFile(anyMeasures, text, source).journeys;

/** The data file as the harness reads it: every journey limits every measure. */
export const harnessCeilings = (
  text: string,
  source: string,
): Record<string, Record<Measure, number>> => parseFile(harnessMeasures, text, source).journeys;

export type Change =
  | {
      readonly kind: 'raised' | 'lowered';
      readonly journey: string;
      readonly measure: string;
      readonly base: number;
      readonly head: number;
    }
  /** A measure that had a ceiling at the base and has none now. */
  | {
      readonly kind: 'unbounded';
      readonly journey: string;
      readonly measure: string;
      readonly base: number;
    }
  /** A journey that is gone; a renamed journey is removed under its old name. */
  | { readonly kind: 'removed'; readonly journey: string }
  /** A new journey, or a new measure of a journey when `measure` is set. */
  | { readonly kind: 'added'; readonly journey: string; readonly measure?: string };

/** Every difference between two sets of ceilings, base journeys first, in file order. */
export function compareCeilings(base: Ceilings, head: Ceilings): Change[] {
  const changes: Change[] = [];
  for (const [journey, before] of Object.entries(base)) {
    const after = head[journey];
    if (!after) {
      changes.push({ kind: 'removed', journey });
      continue;
    }
    for (const [measure, ceiling] of Object.entries(before)) {
      const now = after[measure];
      if (now === undefined) changes.push({ kind: 'unbounded', journey, measure, base: ceiling });
      else if (now !== ceiling)
        changes.push({
          kind: now > ceiling ? 'raised' : 'lowered',
          journey,
          measure,
          base: ceiling,
          head: now,
        });
    }
    for (const measure of Object.keys(after))
      if (!(measure in before)) changes.push({ kind: 'added', journey, measure });
  }
  for (const journey of Object.keys(head))
    if (!(journey in base)) changes.push({ kind: 'added', journey });
  return changes;
}

/** Whether a change needs the owner's re-record label. */
export const needsReRecord = (change: Change) =>
  change.kind === 'raised' || change.kind === 'removed' || change.kind === 'unbounded';

/** An item of a pull request's timeline; only label events are read. */
export interface TimelineEvent {
  readonly event?: string;
  readonly created_at?: string;
  readonly actor?: { readonly login: string } | null;
  readonly label?: { readonly name: string };
}

export type Approval =
  | { readonly status: 'absent' }
  | {
      readonly status: 'approved' | 'not-owner';
      readonly actor: string | null;
      readonly at: string;
    };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** GitHub's times are ISO 8601 in UTC, so they sort as text. */
const time = (event: TimelineEvent) => event.created_at ?? '';

/**
 * Whether `label` is on the pull request, and whether `owner` applied it: the label is on it
 * when its latest label event is `labeled`, and approves only when that event's actor is the
 * owner. GitHub logins and label names ignore case.
 */
export function labelApproval(
  events: readonly TimelineEvent[],
  label: string,
  owner: string,
): Approval {
  const latest = events
    .filter(
      (item) =>
        (item.event === 'labeled' || item.event === 'unlabeled') &&
        item.label !== undefined &&
        same(item.label.name, label),
    )
    // The timeline is oldest first; the sort is stable, so events at the same time keep it.
    .sort((a, b) => (time(a) < time(b) ? -1 : time(a) > time(b) ? 1 : 0))
    .at(-1);
  if (!latest || latest.event === 'unlabeled') return { status: 'absent' };
  const actor = latest.actor?.login ?? null;
  return {
    status: actor !== null && same(actor, owner) ? 'approved' : 'not-owner',
    actor,
    at: latest.created_at ?? 'an unknown time',
  };
}

const timelinePage = z.array(z.looseObject({ event: z.string().optional() }));
const labelEvent = z.looseObject({
  event: z.enum(['labeled', 'unlabeled']),
  created_at: z.string(),
  // null for a deleted account.
  actor: z.looseObject({ login: z.string() }).nullable(),
  label: z.looseObject({ name: z.string() }),
});
/** 5,000 timeline items; a pull request with more is not one this check can judge. */
const maxPages = 50;

/** The URL of the next page in a GitHub Link header, if any. */
const nextPage = (link: string | null) => /<([^>]+)>\s*;\s*rel="next"/.exec(link ?? '')?.[1];

/** Every label event on a pull request's timeline, oldest first, from all of GitHub's pages. */
export async function fetchLabelEvents(options: {
  readonly apiUrl: string;
  readonly repository: string;
  readonly pullRequest: number;
  readonly token: string;
  readonly fetch: typeof fetch;
}): Promise<TimelineEvent[]> {
  const origin = new URL(options.apiUrl).origin;
  const events: TimelineEvent[] = [];
  let url: string | undefined =
    `${options.apiUrl.replace(/\/+$/, '')}/repos/${options.repository}/issues/${options.pullRequest}/timeline?per_page=100`;
  for (let page = 1; url !== undefined; page += 1) {
    if (page > maxPages)
      throw new Error(
        `Pull request #${options.pullRequest}'s timeline has more than ${maxPages} pages.`,
      );
    const response = await options.fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${options.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'splitbook-ceilings-compare',
      },
    });
    if (!response.ok)
      throw new Error(
        `GitHub answered HTTP ${response.status} for pull request #${options.pullRequest}'s timeline (${url}).` +
          ([401, 403, 404].includes(response.status)
            ? " The job's token needs the pull-requests: read permission."
            : ''),
      );
    const items = timelinePage.safeParse(await response.json());
    if (!items.success) throw new Error(`GitHub's timeline page ${page} is not a list of events.`);
    for (const item of items.data) {
      if (item.event !== 'labeled' && item.event !== 'unlabeled') continue;
      const parsed = labelEvent.safeParse(item);
      if (!parsed.success)
        throw new Error(`A ${item.event} event on page ${page} has no label, actor or time.`);
      events.push(parsed.data);
    }
    url = nextPage(response.headers.get('link'));
    // The token goes only to the API it was given for.
    if (url !== undefined && new URL(url).origin !== origin)
      throw new Error(`GitHub's next page is at ${url}, outside ${origin}, so it was not read.`);
  }
  return events;
}

export interface CompareContext {
  /** `apps/mobile`, or a directory laid out like it. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  readonly print: (line: string) => void;
}

export const usage = [
  'Usage: pnpm mobile ceilings:compare --base <commit>',
  '         [--pull-request <number> --repository <owner/name> --owner <login>] [--label <name>]',
  'With --pull-request, GITHUB_TOKEN must be set (and GITHUB_API_URL, if not api.github.com).',
].join('\n');

class Refused extends Error {}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function changeLine(change: Change) {
  switch (change.kind) {
    case 'raised':
    case 'lowered':
      return `${change.kind.padEnd(8)} ${change.journey}: ${change.measure} ${change.base} → ${change.head}`;
    case 'unbounded':
      return `removed  ${change.journey}: ${change.measure} had a ceiling of ${change.base} and has none now`;
    case 'removed':
      return `removed  ${change.journey} (removed or renamed)`;
    case 'added':
      return change.measure
        ? `added    ${change.journey}: a ceiling for ${change.measure}`
        : `added    ${change.journey}`;
  }
}

/** One line for GitHub's log, which turns it into an annotation on the pull request. */
const annotation = (level: 'error' | 'notice', title: string, message: string) =>
  `::${level} title=${title}::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`;

/** `ceilings:compare`. Returns the exit code: 0 passes, 1 needs the label, 2 could not compare. */
export async function runCeilingsCompare(
  argv: readonly string[],
  context: CompareContext,
): Promise<0 | 1 | 2> {
  const { print } = context;
  try {
    return await compare(argv, context);
  } catch (error) {
    print(error instanceof Refused ? `${error.message}\n${usage}` : (error as Error).message);
    if (context.env.GITHUB_ACTIONS === 'true')
      print(annotation('error', 'Ceilings not compared', (error as Error).message));
    return 2;
  }
}

async function compare(argv: readonly string[], context: CompareContext): Promise<0 | 1> {
  const { cwd, env, print } = context;
  let values: Record<string, string | undefined>;
  try {
    values = parseArgs({
      args: [...argv],
      options: {
        base: { type: 'string' },
        'pull-request': { type: 'string' },
        repository: { type: 'string' },
        owner: { type: 'string' },
        label: { type: 'string', default: reRecordLabel },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    throw new Refused((error as Error).message);
  }
  const { base, repository, owner } = values;
  const label = values.label ?? reRecordLabel;
  if (!base || base.startsWith('-')) throw new Refused('--base <commit> is required.');
  const onPullRequest = [values['pull-request'], repository, owner].some(Boolean);
  if (onPullRequest) {
    if (!/^[1-9]\d*$/.test(values['pull-request'] ?? ''))
      throw new Refused('--pull-request needs the pull request number.');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? ''))
      throw new Refused('--repository needs <owner>/<name>.');
    if (!/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(owner ?? ''))
      throw new Refused('--owner needs the repository owner’s login.');
  }

  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      env: env as NodeJS.ProcessEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  let commit: string;
  try {
    commit = git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  } catch {
    throw new Error(
      `Can't find the base commit ${base}. Fetch it first (git fetch origin main), or name another with --base.`,
    );
  }
  const short = commit.slice(0, 7);
  // `<commit>:./path` is relative to cwd, which is apps/mobile.
  const atBase = `${commit}:./${ceilingsFile}`;
  let baseText: string | undefined;
  try {
    git('cat-file', '-e', atBase);
    baseText = git('show', atBase);
  } catch {
    baseText = undefined;
  }
  const before =
    baseText === undefined ? {} : parseCeilings(baseText, `${ceilingsFile} at ${short}`);
  let headText: string;
  try {
    headText = readFileSync(join(cwd, ceilingsFile), 'utf8');
  } catch (error) {
    throw new Error(`Can't read ${ceilingsFile}: ${(error as Error).message}`);
  }
  const changes = compareCeilings(before, parseCeilings(headText, ceilingsFile));

  print(
    `Ceilings in ${ceilingsFile}, compared with ${short}${base === commit ? '' : ` (${base})`}:`,
  );
  if (baseText === undefined) print(`${short} has no ${ceilingsFile}, so every journey is new.`);
  for (const change of changes) print(`  ${changeLine(change)}`);
  if (changes.length === 0) print('  no changes');

  const rose = changes.filter((change) => change.kind === 'raised' || change.kind === 'unbounded');
  const removed = changes.filter((change) => change.kind === 'removed');
  if (rose.length === 0 && removed.length === 0) {
    print('No ceiling rose, and no journey was removed or renamed.');
    return 0;
  }
  const summary = [
    rose.length ? `${plural(rose.length, 'ceiling', 'ceilings')} rose` : '',
    removed.length
      ? `${plural(removed.length, 'journey was', 'journeys were')} removed or renamed`
      : '',
  ]
    .filter(Boolean)
    .join(' and ');
  const steps =
    'Explain each change in the pull request, then ask the owner for the label. ' +
    'Lowering a ceiling or adding a journey never needs it.';

  if (!onPullRequest) {
    print(`${summary}, so the pull request needs the owner's ${label} label. ${steps}`);
    return 1;
  }
  const pullRequest = Number(values['pull-request']);
  const token = env.GITHUB_TOKEN;
  if (!token)
    throw new Error(
      `GITHUB_TOKEN is not set, so pull request #${pullRequest}'s labels can't be read.`,
    );
  const events = await fetchLabelEvents({
    apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
    repository: repository!,
    pullRequest,
    token,
    fetch: context.fetch,
  });
  const approval = labelApproval(events, label, owner!);
  if (approval.status === 'approved') {
    const message = `${summary}. ${approval.actor} applied ${label} at ${approval.at}, which approves this re-record.`;
    print(message);
    if (env.GITHUB_ACTIONS === 'true') print(annotation('notice', 'Ceilings re-recorded', message));
    return 0;
  }
  const message =
    approval.status === 'absent'
      ? `${summary}, and pull request #${pullRequest} doesn't have the ${label} label. ${steps} Adding it runs this check again.`
      : `${summary}. The ${label} label on pull request #${pullRequest} was last applied by ${approval.actor ?? 'a deleted account'}, not the repository owner ${owner}, so it doesn't approve this re-record. Only the owner's label counts: ask ${owner} to remove it and apply it again.`;
  print(message);
  if (env.GITHUB_ACTIONS === 'true')
    print(annotation('error', 'Ceilings need a re-record', message));
  return 1;
}
