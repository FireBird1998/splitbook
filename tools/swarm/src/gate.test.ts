import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Fiber } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { up } from './backend.ts';
import { defaultVitestWorkers, gate, verdictPath, type Verdict } from './gate.ts';
import { lockPath } from './lock.ts';
import {
  fakeLayer,
  fakeWorld,
  fixtureWorktree,
  removeFixtures,
  until,
  type FakeWorld,
} from './test-fakes.ts';
import type { Launch } from './platform.ts';

afterEach(removeFixtures);

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const mobileScripts = {
  test: 'vitest run',
  'verify:api': 'x',
  'verify:groups': 'x',
  'verify:financial': 'x',
  'verify:all': 'node scripts/verify-all.mjs',
  'verify:offline': 'x',
};

function worktree(scripts: Record<string, string> = mobileScripts) {
  return fixtureWorktree({ 'apps/mobile/package.json': JSON.stringify({ scripts }) });
}

function world(): FakeWorld {
  const fake = fakeWorld();
  fake.outputs.set('git rev-parse HEAD', head);
  fake.outputs.set('git merge-base HEAD origin/main', base);
  return fake;
}

const runGate = (fake: FakeWorld, options: Parameters<typeof gate>[0]) =>
  Effect.runPromise(gate(options).pipe(Effect.provide(fakeLayer(fake))));

/** What each launch ran, as one readable string. */
const commands = (fake: FakeWorld) =>
  fake.launches.map((launch) =>
    [launch.command.endsWith('node') ? 'node' : launch.command, ...launch.args]
      .join(' ')
      .replace(/\S*\/dev-backend\//, ''),
  );

const isVerifier = (launch: Launch) => launch.args.some((arg) => arg.startsWith('verify:'));
const step = (verdict: Verdict, name: string) => verdict.steps.find((each) => each.name === name);

describe('gate', () => {
  it('runs every step in order against its own backend and passes', async () => {
    const root = worktree();
    const fake = world();

    const verdict = await runGate(fake, { root });

    expect(verdict.verdict).toBe('pass');
    expect(verdict.steps.map((each) => [each.name, each.status])).toEqual([
      ['install check', 'pass'],
      ['lint', 'pass'],
      ['typecheck', 'pass'],
      ['format check', 'pass'],
      ['unit tests', 'pass'],
      ['ceilings', 'skip'],
      ['backend', 'pass'],
      ['verify:api', 'pass'],
      ['verify:groups', 'pass'],
      ['verify:financial', 'pass'],
      ['verify:offline', 'pass'],
    ]);
    expect(commands(fake)).toEqual([
      'pnpm lint',
      'pnpm typecheck',
      'pnpm format:check',
      'pnpm --recursive --workspace-concurrency=1 test:unit',
      'node seed.mjs',
      'node start.mjs',
      'pnpm --dir apps/mobile run verify:api',
      'pnpm --dir apps/mobile run verify:groups',
      'pnpm --dir apps/mobile run verify:financial',
      'pnpm --dir apps/mobile run verify:offline',
    ]);
    expect(verdict).toMatchObject({ commit: head, base: { ref: 'origin/main', commit: base } });
    expect(verdict.worktree).toBe(root);
  });

  it('runs the verifiers one after another with this backend, and verify:financial in Asia/Kolkata', async () => {
    const fake = world();
    const verdict = await runGate(fake, { root: worktree() });

    const verifiers = fake.launches.filter(isVerifier);
    expect(verifiers.map((launch) => launch.args.at(-1))).toEqual([
      'verify:api',
      'verify:groups',
      'verify:financial',
      'verify:offline',
    ]);
    for (const launch of verifiers) {
      expect(launch.env).toMatchObject({
        MOBILE_VERIFY_URL: verdict.backend?.origin,
        SPLITBOOK_NATIVE_ORIGIN_PORT: '53001',
        SPLITBOOK_NATIVE_DATABASE: verdict.backend?.database,
        SPLITBOOK_NATIVE_MONGO_PORT: '27018',
        TZ: 'Asia/Kolkata',
      });
    }
    expect(verdict.backend?.origin).toBe('http://127.0.0.1:53001');
  });

  it('caps vitest workers at the default, and a per-run setting changes the cap', async () => {
    const unitTests = (fake: FakeWorld) =>
      fake.launches.find((launch) => launch.args.includes('test:unit'));

    const byDefault = world();
    const verdict = await runGate(byDefault, { root: worktree() });
    expect(defaultVitestWorkers).toBe(2);
    expect(unitTests(byDefault)?.env.VITEST_MAX_WORKERS).toBe('2');
    expect(verdict.vitestWorkers).toBe(2);

    const capped = world();
    await runGate(capped, { root: worktree(), vitestWorkers: 5 });
    expect(unitTests(capped)?.env.VITEST_MAX_WORKERS).toBe('5');
  });

  it('never runs the web integration tests', async () => {
    const fake = world();
    await runGate(fake, { root: worktree() });
    const ran = commands(fake).join('\n');
    expect(ran).not.toMatch(/integration/);
    expect(ran).not.toMatch(/(^|\s)test(\s|$)/m);
  });

  it('reports each step for a mix of passing and failing steps, keeps going, and fails', async () => {
    const root = worktree();
    const fake = world();
    fake.exitCodes = (launch) =>
      launch.args.includes('lint') || launch.args.includes('verify:groups') ? 1 : 0;

    const verdict = await runGate(fake, { root });

    expect(verdict.verdict).toBe('fail');
    expect(step(verdict, 'lint')).toMatchObject({ status: 'fail', detail: 'exit code 1' });
    expect(step(verdict, 'typecheck')?.status).toBe('pass');
    expect(step(verdict, 'verify:groups')?.status).toBe('fail');
    expect(step(verdict, 'verify:financial')?.status).toBe('pass');
    expect(step(verdict, 'lint')?.log).toMatch(/tools\/swarm\/out\/gate\/lint\.log$/);
    for (const each of verdict.steps) expect(each.seconds).toBeGreaterThanOrEqual(0);

    const printed = fake.lines.join('\n');
    expect(printed).toMatch(/FAIL\s+lint/);
    expect(printed).toMatch(/PASS\s+typecheck/);
    expect(printed).toMatch(/FAIL\s+verify:groups/);
    expect(printed).toContain(head.slice(0, 7));
    expect(printed).toContain(base.slice(0, 7));
    expect(printed).toMatch(/Gate: FAIL/);
  });

  it('passes no step credentials, database settings or another backend', async () => {
    const planted = {
      MONGODB_URI: 'mongodb://127.0.0.1:27018/splitbook_mobile_50',
      TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017/',
      AUTH_SECRET: 'fictional-secret',
      AUTH_GOOGLE_ID: 'fictional-id',
      BETTER_AUTH_SECRET: 'fictional-secret',
      GOOGLE_CLIENT_SECRET: 'fictional-secret',
      ALLOW_DEMO_AUTH: 'true',
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:4138',
      SPLITBOOK_NATIVE_DATABASE: 'splitbook_mobile_50',
      SPLITBOOK_NATIVE_ORIGIN_PORT: '4138',
      MOBILE_VERIFY_URL: 'http://127.0.0.1:4138',
      SOME_API_KEY: 'fictional-key',
      NPM_TOKEN: 'fictional-token',
      DB_PASSWORD: 'fictional-password',
    };
    const saved = { ...process.env };
    Object.assign(process.env, planted);
    try {
      const fake = world();
      const verdict = await runGate(fake, { root: worktree() });

      const steps = fake.launches.filter((launch) => launch.command === 'pnpm');
      expect(steps.length).toBeGreaterThan(4);
      for (const launch of steps) {
        for (const name of Object.keys(planted)) {
          if (isVerifier(launch) && /^(SPLITBOOK_NATIVE_|MOBILE_VERIFY_URL)/.test(name)) continue;
          expect({ name, value: launch.env[name] }).toEqual({ name, value: undefined });
        }
        expect(launch.env.PATH).toBe(process.env.PATH);
      }
      for (const launch of steps.filter(isVerifier)) {
        expect(launch.env).toMatchObject({
          MOBILE_VERIFY_URL: verdict.backend?.origin,
          SPLITBOOK_NATIVE_DATABASE: verdict.backend?.database,
          SPLITBOOK_NATIVE_ORIGIN_PORT: '53001',
        });
      }
    } finally {
      for (const name of Object.keys(planted)) delete process.env[name];
      Object.assign(process.env, saved);
    }
  });

  it('is refused while another swarm command holds the worktree lock, and writes no verdict', async () => {
    const root = worktree();
    const fake = world();
    fake.startTimes.set(4999, 'then');
    mkdirSync(join(root, 'tools/swarm/out'), { recursive: true });
    writeFileSync(lockPath(root), JSON.stringify({ pid: 4999, started: 'then', command: 'up' }));

    const error = await Effect.runPromise(
      Effect.flip(gate({ root })).pipe(Effect.provide(fakeLayer(fake))),
    );

    expect(error.message).toMatch(/Another pnpm swarm up \(pid 4999\)/);
    expect(fake.launches).toEqual([]);
    expect(existsSync(verdictPath(root))).toBe(false);
  });

  it('records a failed step instead of stopping when apps/mobile/package.json cannot be read', async () => {
    const fake = world();
    const verdict = await runGate(fake, {
      root: fixtureWorktree({ 'apps/mobile/package.json': '{ not json' }),
    });
    expect(verdict.verdict).toBe('fail');
    expect(step(verdict, 'verifiers')).toMatchObject({
      status: 'fail',
      detail: expect.stringMatching(/apps\/mobile\/package\.json/),
    });
    expect(step(verdict, 'unit tests')?.status).toBe('pass');
  });

  it('writes the same verdict as JSON for the orchestrator', async () => {
    const root = worktree();
    const verdict = await runGate(world(), { root });
    expect(JSON.parse(readFileSync(verdictPath(root), 'utf8'))).toEqual(verdict);
  });

  it('stops at a stale install, before any test can fail for the wrong reason', async () => {
    const root = fixtureWorktree({ 'node_modules/.pnpm/lock.yaml': 'stale' });
    const fake = world();

    const verdict = await runGate(fake, { root });

    expect(verdict.verdict).toBe('fail');
    expect(verdict.steps[0]).toMatchObject({ name: 'install check', status: 'fail' });
    expect(verdict.steps[0]?.detail).toContain('pnpm install --frozen-lockfile --offline');
    expect(verdict.steps.slice(1).every((each) => each.status === 'skip')).toBe(true);
    expect(fake.launches).toEqual([]);
  });

  describe('ceilings', () => {
    it("skips the step on a branch without #206's comparison script", async () => {
      const verdict = await runGate(world(), { root: worktree() });
      expect(step(verdict, 'ceilings')).toMatchObject({
        status: 'skip',
        detail: expect.stringMatching(/No ceilings are recorded/),
      });
    });

    it("calls #206's comparison script with the base commit, and passes when no ceiling rose", async () => {
      const fake = world();
      const verdict = await runGate(fake, {
        root: worktree({ ...mobileScripts, 'ceilings:compare': 'node scripts/compare.ts' }),
      });
      expect(commands(fake)).toContain(
        `pnpm --dir apps/mobile run ceilings:compare --base ${base}`,
      );
      expect(step(verdict, 'ceilings')?.status).toBe('pass');
    });

    it("fails a raised ceiling and says the owner's re-record label is needed", async () => {
      const fake = world();
      fake.exitCodes = (launch) => (launch.args.includes('ceilings:compare') ? 1 : 0);
      const verdict = await runGate(fake, {
        root: worktree({ ...mobileScripts, 'ceilings:compare': 'node scripts/compare.ts' }),
      });
      expect(verdict.verdict).toBe('fail');
      expect(step(verdict, 'ceilings')).toMatchObject({
        status: 'fail',
        detail: expect.stringMatching(
          /a ceiling rose, or a journey was removed or renamed, since bbbbbbb, so the pull request needs the owner's re-record-ceilings label/,
        ),
      });
    });

    it("fails without blaming a ceiling when the comparison couldn't run", async () => {
      const fake = world();
      fake.exitCodes = (launch) => (launch.args.includes('ceilings:compare') ? 2 : 0);
      const verdict = await runGate(fake, {
        root: worktree({ ...mobileScripts, 'ceilings:compare': 'node scripts/compare.ts' }),
      });
      expect(verdict.verdict).toBe('fail');
      expect(step(verdict, 'ceilings')).toMatchObject({
        status: 'fail',
        detail: expect.stringMatching(/could not be compared with bbbbbbb \(exit code 2\)/),
      });
      expect(step(verdict, 'ceilings')?.detail).not.toMatch(/re-record/);
    });
  });

  it("uses the worktree's backend when it is up, and leaves it running", async () => {
    const root = worktree();
    const fake = world();
    const { backend } = await Effect.runPromise(up({ root }).pipe(Effect.provide(fakeLayer(fake))));
    const before = fake.launches.length;

    const verdict = await runGate(fake, { root });

    expect(step(verdict, 'backend')?.detail).toMatch(/pnpm swarm up/);
    expect(verdict.backend).toEqual({
      origin: backend.origin,
      database: backend.database,
      startedByGate: false,
    });
    expect(commands(fake).slice(before)).not.toContainEqual(expect.stringMatching(/seed|start/));
    expect(fake.stopped).toEqual([]);
    expect(fake.running.has(backend.pid ?? -1)).toBe(true);
  });

  it('stops the backend it started, and drops its database, when it ends', async () => {
    const fake = world();
    const verdict = await runGate(fake, { root: worktree() });
    expect(verdict.backend?.startedByGate).toBe(true);
    expect(fake.running.size).toBe(0);
    expect(fake.dropped).toEqual([verdict.backend?.database]);
  });

  it('stops a step at its timeout, fails it, and goes on', async () => {
    const fake = world();
    fake.exitCodes = (launch) => (launch.args.includes('typecheck') ? 'hang' : 0);

    const verdict = await runGate(fake, { root: worktree(), stepTimeout: '200 millis' });

    expect(step(verdict, 'typecheck')).toMatchObject({
      status: 'fail',
      detail: expect.stringMatching(/timed out after 0\.2 s/),
    });
    expect(step(verdict, 'format check')?.status).toBe('pass');
    expect(fake.running.size).toBe(0);
  });

  it('when interrupted, stops the running step and the backend it started, and records the interruption', async () => {
    const root = worktree();
    const fake = world();
    fake.exitCodes = (launch) => (launch.args.includes('verify:groups') ? 'hang' : 0);
    const fiber = Effect.runFork(gate({ root }).pipe(Effect.provide(fakeLayer(fake))));
    await until(() => fake.launches.some((launch) => launch.args.includes('verify:groups')));

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(fake.running.size).toBe(0);
    expect(fake.dropped).toHaveLength(1);
    expect(fake.databases.size).toBe(0);
    const written = JSON.parse(readFileSync(verdictPath(root), 'utf8')) as Verdict;
    expect(written).toMatchObject({ verdict: 'fail', interrupted: true });
    expect(written.steps.map((each) => each.name)).toContain('verify:api');
    expect(written.steps.at(-1)).toMatchObject({
      name: 'verify:groups',
      status: 'fail',
      detail: expect.stringMatching(/interrupted/),
    });
  });
});
