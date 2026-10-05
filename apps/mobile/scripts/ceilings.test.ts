import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ceilingsFile,
  compareCeilings,
  harnessCeilings,
  labelApproval,
  needsReRecord,
  parseCeilings,
  reRecordLabel,
  runCeilingsCompare,
  type Ceilings,
  type TimelineEvent,
} from './ceilings';

/** A pull request's timeline, recorded from GitHub and made fictional (see the file's `about`). */
const timeline = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/re-record-timeline.json'), 'utf8'),
) as { owner: string; approvers: string[]; events: TimelineEvent[] };
/** The repository owner, the only approver when CEILINGS_APPROVERS isn't set. */
const owner = timeline.owner;
/** The owner and the owner's second account, as CEILINGS_APPROVERS would list them. */
const approvers = timeline.approvers;
const [, second] = approvers;
/** The timeline as it stood once its first `count` events had happened. */
const after = (count: number) => timeline.events.slice(0, count);

const base: Ceilings = {
  'Open a Group on Expenses': { requests: 4, publishes: 11, commits: 4, renders: 512 },
  'Switch to Balances': { requests: 0, publishes: 1, commits: 1, renders: 57 },
};
const withCeiling = (journey: string, measure: string, value: number): Ceilings => ({
  ...base,
  [journey]: { ...base[journey], [measure]: value },
});

describe('compareCeilings', () => {
  it('finds nothing when no ceiling changed', () => {
    expect(compareCeilings(base, structuredClone(base))).toEqual([]);
  });

  it('needs a re-record when a ceiling rose', () => {
    const changes = compareCeilings(base, withCeiling('Open a Group on Expenses', 'requests', 5));
    expect(changes).toEqual([
      {
        kind: 'raised',
        journey: 'Open a Group on Expenses',
        measure: 'requests',
        base: 4,
        head: 5,
      },
    ]);
    expect(changes.some(needsReRecord)).toBe(true);
  });

  it('never needs a re-record to lower a ceiling', () => {
    const changes = compareCeilings(base, withCeiling('Switch to Balances', 'renders', 40));
    expect(changes).toEqual([
      { kind: 'lowered', journey: 'Switch to Balances', measure: 'renders', base: 57, head: 40 },
    ]);
    expect(changes.some(needsReRecord)).toBe(false);
  });

  it('never needs a re-record to add a journey or a measure', () => {
    const changes = compareCeilings(base, {
      ...base,
      'Switch to Balances': { ...base['Switch to Balances'], frames: 3 },
      'Back to Home from a Group': { requests: 0, publishes: 3, commits: 1, renders: 146 },
    });
    expect(changes).toEqual([
      { kind: 'added', journey: 'Switch to Balances', measure: 'frames' },
      { kind: 'added', journey: 'Back to Home from a Group' },
    ]);
    expect(changes.some(needsReRecord)).toBe(false);
  });

  it('needs a re-record when a journey is removed', () => {
    const changes = compareCeilings(base, { 'Switch to Balances': base['Switch to Balances'] });
    expect(changes).toEqual([{ kind: 'removed', journey: 'Open a Group on Expenses' }]);
    expect(changes.some(needsReRecord)).toBe(true);
  });

  it('needs a re-record when a journey is renamed, even with the same ceilings', () => {
    const changes = compareCeilings(base, {
      'Open a Group': base['Open a Group on Expenses'],
      'Switch to Balances': base['Switch to Balances'],
    });
    expect(changes).toEqual([
      { kind: 'removed', journey: 'Open a Group on Expenses' },
      { kind: 'added', journey: 'Open a Group' },
    ]);
    expect(changes.some(needsReRecord)).toBe(true);
  });

  it('needs a re-record when a measure loses its ceiling', () => {
    const unbounded = { ...base['Switch to Balances'] };
    delete unbounded.requests;
    const changes = compareCeilings(base, { ...base, 'Switch to Balances': unbounded });
    expect(changes).toEqual([
      { kind: 'unbounded', journey: 'Switch to Balances', measure: 'requests', base: 0 },
    ]);
    expect(changes.some(needsReRecord)).toBe(true);
  });
});

describe('the ceilings data file', () => {
  const file = (journeys: unknown) => JSON.stringify({ about: 'fixture', journeys });

  it('holds whole, non-negative counts per journey', () => {
    expect(parseCeilings(file(base), 'the fixture')).toEqual(base);
    expect(() => parseCeilings(file({ 'Change Month': { renders: -1 } }), 'the fixture')).toThrow(
      /the fixture/,
    );
    expect(() => parseCeilings(file({ 'Change Month': { renders: 1.5 } }), 'x')).toThrow();
    expect(() => parseCeilings('{ "journeys": ', 'the fixture')).toThrow(/the fixture/);
    expect(() => parseCeilings(JSON.stringify({ ceilings: base }), 'x')).toThrow();
  });

  it('gives the harness every measure of every journey', () => {
    expect(harnessCeilings(file(base), 'the fixture')).toEqual(base);
    expect(() =>
      harnessCeilings(file({ 'Change Month': { publishes: 8, commits: 3, renders: 468 } }), 'x'),
    ).toThrow(/requests/);
  });

  it('is the one committed file, and the harness has a ceiling in it for each journey', () => {
    const committed = harnessCeilings(
      readFileSync(join(import.meta.dirname, '..', ceilingsFile), 'utf8'),
      ceilingsFile,
    );
    expect(Object.keys(committed).length).toBeGreaterThan(0);
  });
});

describe('labelApproval, from the recorded timeline', () => {
  it('finds no label while only another label is on the pull request', () => {
    expect(labelApproval(after(3), reRecordLabel, approvers)).toEqual({ status: 'absent' });
    expect(labelApproval([], reRecordLabel, approvers)).toEqual({ status: 'absent' });
  });

  it('approves the label when the owner applied it', () => {
    expect(labelApproval(after(4), reRecordLabel, [owner])).toEqual({
      status: 'approved',
      actor: owner,
      at: '2026-10-05T08:00:00Z',
    });
    // A later push keeps the owner's label on the pull request.
    expect(labelApproval(after(5), reRecordLabel, [owner]).status).toBe('approved');
  });

  it('finds no label once it was removed', () => {
    expect(labelApproval(after(6), reRecordLabel, approvers)).toEqual({ status: 'absent' });
    expect(labelApproval(after(8), reRecordLabel, approvers)).toEqual({ status: 'absent' });
    expect(labelApproval(after(10), reRecordLabel, approvers)).toEqual({ status: 'absent' });
  });

  it('refuses the label when an account not on the list applied it last', () => {
    expect(labelApproval(after(7), reRecordLabel, approvers)).toEqual({
      status: 'not-approver',
      actor: 'helpful-collaborator',
      at: '2026-10-05T09:00:20Z',
    });
  });

  it('approves the label again once the owner re-applies it after an account not on the list', () => {
    expect(labelApproval(after(9), reRecordLabel, approvers)).toEqual({
      status: 'approved',
      actor: owner,
      at: '2026-10-05T10:15:30Z',
    });
  });

  it("accepts a second listed approver, the owner's other account", () => {
    expect(labelApproval(after(11), reRecordLabel, approvers)).toEqual({
      status: 'approved',
      actor: second,
      at: '2026-10-05T11:00:10Z',
    });
    // With the owner alone on the list, as CI runs without CEILINGS_APPROVERS, it is refused.
    expect(labelApproval(after(11), reRecordLabel, [owner])).toMatchObject({
      status: 'not-approver',
      actor: second,
    });
  });

  it('approves nobody with an empty list', () => {
    expect(labelApproval(after(4), reRecordLabel, [])).toMatchObject({ status: 'not-approver' });
  });

  it('compares logins and the label without case, and never approves a deleted account', () => {
    expect(labelApproval(after(4), 'Re-Record-Ceilings', ['Maple-Owner']).status).toBe('approved');
    const ghost = { ...after(4)[3]!, actor: null };
    expect(labelApproval([...after(3), ghost], reRecordLabel, approvers)).toEqual({
      status: 'not-approver',
      actor: null,
      at: '2026-10-05T08:00:00Z',
    });
  });
});

/**
 * GitHub's timeline endpoint over the given events, with Link headers. It serves `perPage`
 * events a page whatever `per_page` asks for, so a short timeline still spans several pages.
 */
function github(events: readonly TimelineEvent[], options: { perPage?: number; status?: number }) {
  const perPage = options.perPage ?? 4;
  const requests: { url: string; authorization: string | null }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({
      url: String(url),
      authorization: new Headers(init?.headers).get('authorization'),
    });
    if (options.status)
      return new Response('{"message":"Resource not accessible"}', { status: options.status });
    const page = Number(url.searchParams.get('page') ?? '1');
    const pages = Math.max(1, Math.ceil(events.length / perPage));
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (page < pages) {
      // GitHub's next link names the repository by id, not by name.
      const next = new URL('https://api.github.com/repositories/900000/issues/42/timeline');
      next.searchParams.set('per_page', url.searchParams.get('per_page') ?? '30');
      next.searchParams.set('page', String(page + 1));
      headers.set('Link', `<${next}>; rel="next", <${next}>; rel="last"`);
    }
    return Response.json(events.slice((page - 1) * perPage, page * perPage), { headers });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

describe('ceilings:compare', () => {
  let repo: string;
  let withoutFile: string;
  let withFile: string;
  // Git must not see the developer's own configuration, or a hook's repository, and the
  // script must not see a token or a GitHub Actions run of the shell that started the tests.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^GIT(HUB)?_/.test(name)),
  ) as NodeJS.ProcessEnv;
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(tmpdir(), 'no-such-gitconfig'),
    GIT_AUTHOR_NAME: 'Fictional Author',
    GIT_AUTHOR_EMAIL: 'author@example.test',
    GIT_COMMITTER_NAME: 'Fictional Author',
    GIT_COMMITTER_EMAIL: 'author@example.test',
  });
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
  const dataFile = () => join(repo, ceilingsFile);
  const write = (journeys: Ceilings) =>
    writeFileSync(dataFile(), `${JSON.stringify({ about: 'fixture', journeys }, null, 2)}\n`);

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'ceilings-compare-'));
    git('init', '--quiet');
    writeFileSync(join(repo, 'README.md'), 'A fictional package.\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'before the ceilings');
    withoutFile = git('rev-parse', 'HEAD');
    mkdirSync(dirname(dataFile()), { recursive: true });
    write(base);
    git('add', '.');
    git('commit', '--quiet', '-m', 'the ceilings');
    withFile = git('rev-parse', 'HEAD');
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  beforeEach(() => write(base));

  const run = async (
    args: readonly string[],
    options: { token?: string; fetch?: typeof globalThis.fetch } = {},
  ) => {
    const lines: string[] = [];
    const code = await runCeilingsCompare(args, {
      cwd: repo,
      env: { ...env, ...(options.token ? { GITHUB_TOKEN: options.token } : {}) },
      fetch:
        options.fetch ??
        (async () => {
          throw new Error('GitHub must not be asked');
        }),
      print: (line) => lines.push(line),
    });
    return { code, output: lines.join('\n') };
  };
  const pullRequest = ['--pull-request', '42', '--repository', 'maple-owner/fictional-ledger'];

  it('passes when nothing changed, without asking GitHub', async () => {
    const { code, output } = await run([
      '--base',
      withFile,
      ...pullRequest,
      '--approvers',
      approvers.join(','),
    ]);
    expect(code).toBe(0);
    expect(output).toMatch(/No ceiling rose, and no journey was removed or renamed/);
  });

  it('passes when the base commit has no data file yet: every journey is new', async () => {
    const { code, output } = await run(['--base', withoutFile]);
    expect(code).toBe(0);
    expect(output).toMatch(/has no src\/render-profile\.ceilings\.json/);
    expect(output).toMatch(/added +Open a Group on Expenses/);
  });

  it('passes a lowered ceiling and an added journey without the label', async () => {
    write({
      ...withCeiling('Switch to Balances', 'renders', 40),
      'Back to Home from a Group': { requests: 0, publishes: 3, commits: 1, renders: 146 },
    });
    const { code, output } = await run(['--base', withFile]);
    expect(code).toBe(0);
    expect(output).toMatch(/lowered +Switch to Balances: renders 57 → 40/);
    expect(output).toMatch(/added +Back to Home from a Group/);
  });

  it('fails a raised ceiling outside a pull request, naming the journey, both counts and the label', async () => {
    write(withCeiling('Open a Group on Expenses', 'requests', 5));
    const { code, output } = await run(['--base', withFile]);
    expect(code).toBe(1);
    expect(output).toMatch(/raised +Open a Group on Expenses: requests 4 → 5/);
    expect(output).toMatch(/1 ceiling rose/);
    expect(output).toMatch(/re-record-ceilings/);
  });

  it('fails a removed or renamed journey', async () => {
    write({
      'Open a Group': base['Open a Group on Expenses'],
      'Switch to Balances': base['Switch to Balances'],
    });
    const { code, output } = await run(['--base', withFile]);
    expect(code).toBe(1);
    expect(output).toMatch(/removed +Open a Group on Expenses \(removed or renamed\)/);
    expect(output).toMatch(/1 journey was removed or renamed/);
  });

  describe('on a pull request whose ceiling rose', () => {
    beforeEach(() => write(withCeiling('Open a Group on Expenses', 'requests', 5)));
    /** CI with CEILINGS_APPROVERS set to the owner and the owner's second account. */
    const args = () => ['--base', withFile, ...pullRequest, '--approvers', approvers.join(',')];
    /** CI without the variable: `github.repository_owner` alone. */
    const ownerOnly = () => ['--base', withFile, ...pullRequest, '--approvers', owner];
    const timelineAfter = (count: number, perPage?: number) => ({
      token: 'fixture-token',
      fetch: github(after(count), { perPage }).fetch,
    });

    it('fails without the label', async () => {
      const { code, output } = await run(args(), timelineAfter(3));
      expect(code).toBe(1);
      expect(output).toMatch(/doesn't have the re-record-ceilings label/);
    });

    it('passes once the owner applied the label, reading every page of the timeline', async () => {
      const gh = github(after(5), { perPage: 2 });
      const { code, output } = await run(ownerOnly(), { token: 'fixture-token', fetch: gh.fetch });
      expect(code).toBe(0);
      expect(output).toMatch(/maple-owner applied re-record-ceilings at 2026-10-05T08:00:00Z/);
      expect(gh.requests.map((request) => request.url)).toEqual([
        'https://api.github.com/repos/maple-owner/fictional-ledger/issues/42/timeline?per_page=100',
        'https://api.github.com/repositories/900000/issues/42/timeline?per_page=100&page=2',
        'https://api.github.com/repositories/900000/issues/42/timeline?per_page=100&page=3',
      ]);
      expect(new Set(gh.requests.map((request) => request.authorization))).toEqual(
        new Set(['Bearer fixture-token']),
      );
    });

    it('passes when a second listed approver applied the label', async () => {
      const { code, output } = await run(args(), timelineAfter(11));
      expect(code).toBe(0);
      expect(output).toMatch(/maple-second applied re-record-ceilings at 2026-10-05T11:00:10Z/);
    });

    it('fails when an account not on the list applied the label, and names it', async () => {
      const { code, output } = await run(args(), timelineAfter(7));
      expect(code).toBe(1);
      expect(output).toMatch(
        /last applied by helpful-collaborator, who isn't an approver \(maple-owner, maple-second\)/,
      );
    });

    it('passes once the owner re-applies the label after an account not on the list', async () => {
      const { code } = await run(args(), timelineAfter(9));
      expect(code).toBe(0);
    });

    it('accepts only the owner when the list is the owner alone, as without CEILINGS_APPROVERS', async () => {
      expect((await run(ownerOnly(), timelineAfter(9))).code).toBe(0);
      const second = await run(ownerOnly(), timelineAfter(11));
      expect(second.code).toBe(1);
      expect(second.output).toMatch(
        /last applied by maple-second, who isn't an approver \(maple-owner\)/,
      );
    });

    it('takes the approvers from its input, never a fixed login', async () => {
      const { code, output } = await run(
        ['--base', withFile, ...pullRequest, '--approvers', 'helpful-collaborator'],
        timelineAfter(4),
      );
      expect(code).toBe(1);
      expect(output).toMatch(/last applied by maple-owner, who isn't an approver/);
    });

    it('fails closed on an empty or missing list of approvers, without asking GitHub', async () => {
      for (const list of [[], ['--approvers', ''], ['--approvers', ' , ']]) {
        const { code, output } = await run(['--base', withFile, ...pullRequest, ...list], {
          token: 'fixture-token',
        });
        expect(code).toBe(2);
        if (list.length) expect(output).toMatch(/an empty list approves nobody/);
      }
    });

    it("can't compare when GitHub refuses the timeline, and says which permission it needs", async () => {
      const { code, output } = await run(args(), {
        token: 'fixture-token',
        fetch: github([], { status: 403 }).fetch,
      });
      expect(code).toBe(2);
      expect(output).toMatch(/HTTP 403/);
      expect(output).toMatch(/pull-requests: read/);
    });

    it("can't compare a pull request without a token", async () => {
      const { code, output } = await run(args());
      expect(code).toBe(2);
      expect(output).toMatch(/GITHUB_TOKEN/);
    });
  });

  it('never follows a next link to another host with the token', async () => {
    write(withCeiling('Open a Group on Expenses', 'requests', 5));
    const fetch = (async () =>
      Response.json(after(3), {
        headers: { Link: '<https://example.test/steal?page=2>; rel="next"' },
      })) as typeof globalThis.fetch;
    const { code, output } = await run(['--base', withFile, ...pullRequest, '--approvers', owner], {
      token: 'fixture-token',
      fetch,
    });
    expect(code).toBe(2);
    expect(output).toMatch(/example\.test/);
  });

  it("can't compare with an unknown base commit, or a data file that isn't valid", async () => {
    const unknown = await run(['--base', '0000000000000000000000000000000000000000']);
    expect(unknown.code).toBe(2);
    expect(unknown.output).toMatch(/Can't find the base commit/);

    writeFileSync(dataFile(), '{ "journeys": { "Change Month": { "renders": -1 } } }\n');
    const invalid = await run(['--base', withFile]);
    expect(invalid.code).toBe(2);
    expect(invalid.output).toMatch(/src\/render-profile\.ceilings\.json/);
  });

  it('refuses unknown or missing arguments', async () => {
    expect((await run([])).code).toBe(2);
    expect((await run(['--base', withFile, '--labl', 'x'])).code).toBe(2);
    expect((await run(['--base', withFile, '--pull-request', '42'])).code).toBe(2);
    expect((await run(['--base', withFile, '--owner', owner])).code).toBe(2);
    expect(
      (await run(['--base', withFile, ...pullRequest, '--approvers', 'maple-owner,not a login']))
        .code,
    ).toBe(2);
  });
});
