import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Fiber } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { down, readBackend, statePath, toolPrefix, up, worktreePrefix } from './backend.ts';
import { lockPath } from './lock.ts';
import {
  fakeLayer,
  fakeWorld,
  fixtureWorktree,
  removeFixtures,
  until,
  type FakeWorld,
} from './test-fakes.ts';

afterEach(removeFixtures);

function upIn(world: FakeWorld, options: Parameters<typeof up>[0]) {
  return Effect.runPromise(up(options).pipe(Effect.provide(fakeLayer(world))));
}

function upFailure(world: FakeWorld, options: Parameters<typeof up>[0]) {
  return Effect.runPromise(Effect.flip(up(options)).pipe(Effect.provide(fakeLayer(world))));
}

function downIn(world: FakeWorld, options: Parameters<typeof down>[0]) {
  return Effect.runPromise(down(options).pipe(Effect.provide(fakeLayer(world))));
}

function downFailure(world: FakeWorld, options: Parameters<typeof down>[0]) {
  return Effect.runPromise(Effect.flip(down(options)).pipe(Effect.provide(fakeLayer(world))));
}

/** Writes a backend record, as `up` leaves one, with some fields replaced. */
function recordBackend(root: string, fields: Record<string, unknown>) {
  mkdirSync(join(root, 'tools/swarm/out'), { recursive: true });
  writeFileSync(
    statePath(root),
    JSON.stringify({
      origin: 'http://127.0.0.1:53001',
      port: 53001,
      database: `${worktreePrefix(root)}recorded`,
      mongoPort: 27018,
      pid: 4321,
      processStart: 'started 4321',
      log: join(root, 'tools/swarm/out/backend.log'),
      startedAt: '2026-10-04T00:00:00.000Z',
      readySeconds: 1,
      ...fields,
    }),
  );
}

/** Takes the worktree lock as another command would. */
function holdLock(root: string, holder: { pid: number; started: string; command: string }) {
  mkdirSync(join(root, 'tools/swarm/out'), { recursive: true });
  writeFileSync(lockPath(root), JSON.stringify(holder));
}

const startScript = (root: string) => join(root, 'apps/mobile/scripts/dev-backend/start.mjs');

describe('up', () => {
  it('picks a free loopback port and a fresh database with its prefix, seeds, starts and prints MOBILE_VERIFY_URL', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();

    const { backend, reused } = await upIn(world, { root });

    expect(reused).toBe(false);
    expect(backend.origin).toBe('http://127.0.0.1:53001');
    expect(backend.database.startsWith(worktreePrefix(root))).toBe(true);
    expect(worktreePrefix(root).startsWith(toolPrefix)).toBe(true);
    expect(toolPrefix).toBe('splitbook_mobile_swarm_');
    expect(backend.database).toMatch(/^splitbook_mobile_[a-z0-9_]+$/);
    expect(backend.database.length).toBeLessThanOrEqual(63);

    // Seed, then start, through #185's variables, with nothing else inherited.
    const variables = {
      SPLITBOOK_NATIVE_ORIGIN_PORT: '53001',
      SPLITBOOK_NATIVE_DATABASE: backend.database,
      SPLITBOOK_NATIVE_MONGO_PORT: '27018',
    };
    const [seed, start] = world.launches;
    expect(seed?.args).toEqual([join(root, 'apps/mobile/scripts/dev-backend/seed.mjs')]);
    expect(start?.args).toEqual([join(root, 'apps/mobile/scripts/dev-backend/start.mjs')]);
    expect(seed?.env).toEqual({ PATH: process.env.PATH ?? '', ...variables });
    // start.mjs also learns how to serve the web app: next dev unless asked otherwise.
    expect(start?.env).toEqual({
      PATH: process.env.PATH ?? '',
      ...variables,
      SPLITBOOK_NATIVE_SERVER: 'dev',
    });
    expect(backend.server).toBe('dev');
    expect(world.lines).toContain('MOBILE_VERIFY_URL=http://127.0.0.1:53001');
    expect(world.lines).toContain('SPLITBOOK_NATIVE_ORIGIN_PORT=53001');
    expect(world.lines).toContain(`SPLITBOOK_NATIVE_DATABASE=${backend.database}`);
    expect(world.lines).toContain('SPLITBOOK_NATIVE_MONGO_PORT=27018');
    expect(readBackend(root)).toMatchObject({
      origin: backend.origin,
      database: backend.database,
      pid: backend.pid,
      processStart: `started ${backend.pid}`,
    });
    expect(existsSync(lockPath(root))).toBe(false);
  });

  it('starts a production build when asked, with the same safety rules', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();

    const { backend } = await upIn(world, { root, server: 'production', mongoPort: 27017 });

    const [seed, start] = world.launches;
    expect(seed?.env).not.toHaveProperty('SPLITBOOK_NATIVE_SERVER');
    expect(start?.env).toEqual({
      PATH: process.env.PATH ?? '',
      SPLITBOOK_NATIVE_ORIGIN_PORT: '53001',
      SPLITBOOK_NATIVE_DATABASE: backend.database,
      SPLITBOOK_NATIVE_MONGO_PORT: '27017',
      SPLITBOOK_NATIVE_SERVER: 'production',
    });
    expect(backend.database.startsWith(worktreePrefix(root))).toBe(true);
    expect(readBackend(root)).toMatchObject({ server: 'production', mongoPort: 27017 });
    expect(world.lines).toContain(
      'Building the web app for production, then starting the backend at http://127.0.0.1:53001',
    );
    expect(world.lines.some((line) => /production build included\.$/.test(line))).toBe(true);
    // The variables the verifiers and controls get are the same as for next dev.
    expect(world.lines).toContain('SPLITBOOK_NATIVE_MONGO_PORT=27017');
    expect(world.lines.some((line) => line.startsWith('SPLITBOOK_NATIVE_SERVER='))).toBe(false);
  });

  it.each(['prod', 'Production', 'start', ''])(
    'refuses the server %j and changes nothing',
    async (server) => {
      const world = fakeWorld();
      const error = await upFailure(world, { root: fixtureWorktree(), server });
      expect(error._tag).toBe('Refused');
      expect(error.message).toMatch(/dev \(next dev\) or production/);
      expect(world.launches).toEqual([]);
    },
  );

  it('refuses to switch a running backend to another server, and leaves it running', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const first = await upIn(world, { root });

    const error = await upFailure(world, { root, server: 'production' });

    expect(error.message).toMatch(/already up .*\(dev\)\. Run pnpm swarm down first/);
    expect(world.stopped).toEqual([]);
    expect(world.running.has(first.backend.pid ?? -1)).toBe(true);
    // Asking for the mode it already runs in reuses it.
    expect((await upIn(world, { root, server: 'dev' })).reused).toBe(true);
  });

  it('reads a record from before production builds as a dev backend', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const first = await upIn(world, { root });
    const older: Record<string, unknown> = { ...readBackend(root) };
    delete older.server;
    recordBackend(root, older);

    const again = await upIn(world, { root, server: 'dev' });
    expect(again).toMatchObject({ reused: true, backend: { origin: first.backend.origin } });
    expect(again.backend.server).toBeUndefined();
  });

  it('gives two worktrees different ports and databases', async () => {
    const world = fakeWorld();
    const first = await upIn(world, { root: fixtureWorktree() });
    const second = await upIn(world, { root: fixtureWorktree() });
    expect(first.backend.origin).not.toBe(second.backend.origin);
    expect(first.backend.database).not.toBe(second.backend.database);
  });

  it('never picks port 4138, even when the operating system offers it', async () => {
    const world = fakeWorld();
    world.freePorts.unshift(4138);
    const { backend } = await upIn(world, { root: fixtureWorktree() });
    expect(backend.port).toBe(53001);
  });

  it('never picks a port the Fetch standard blocks, even when the operating system offers one', async () => {
    const world = fakeWorld();
    world.freePorts.unshift(4190, 6697, 10080);
    const { backend } = await upIn(world, { root: fixtureWorktree() });
    expect(backend.port).toBe(53001);
    expect(world.launches[0]?.env.SPLITBOOK_NATIVE_ORIGIN_PORT).toBe('53001');
  });

  it('reuses the backend that is already up in the worktree', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const first = await upIn(world, { root });
    const again = await upIn(world, { root });
    expect(again).toEqual({ backend: first.backend, reused: true });
    expect(world.launches.filter((launch) => launch.args[0]?.endsWith('start.mjs'))).toHaveLength(
      1,
    );
  });

  it('cleans up after a backend that is no longer running before starting a new one', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const first = await upIn(world, { root });
    world.running.clear();
    world.listening.clear();

    const second = await upIn(world, { root });

    expect(world.dropped).toEqual([first.backend.database]);
    expect(second.reused).toBe(false);
    expect(second.backend.database).not.toBe(first.backend.database);
  });

  it.each([
    ['splitbook_mobile_50', /shared fictional backend/],
    ['splitbook_mobile_186', /splitbook_mobile_swarm_/],
    ['splitbook-demo', /demo database/],
    ['splitbook', /demo database/],
    ['admin', /splitbook_mobile_swarm_/],
    ['splitbook_mobile_swarm_0123456789_theirs', /another worktree/],
  ])('refuses the database name %j and changes nothing', async (database, message) => {
    const world = fakeWorld();
    const error = await upFailure(world, { root: fixtureWorktree(), database });
    expect(error._tag).toBe('Refused');
    expect(error.message).toMatch(message);
    expect(world.launches).toEqual([]);
    expect(world.dropped).toEqual([]);
  });

  it('refuses a malformed database name with its own prefix', async () => {
    const root = fixtureWorktree();
    const error = await upFailure(fakeWorld(), {
      root,
      database: `${worktreePrefix(root)}${'x'.repeat(40)}`,
    });
    expect(error.message).toMatch(/63 characters/);
    const upper = await upFailure(fakeWorld(), { root, database: `${worktreePrefix(root)}QA` });
    expect(upper.message).toMatch(/lowercase/);
  });

  it('accepts a database name with the worktree prefix', async () => {
    const root = fixtureWorktree();
    const database = `${worktreePrefix(root)}ci`;
    const { backend } = await upIn(fakeWorld(), { root, database });
    expect(backend.database).toBe(database);
  });

  it.each([
    ['http://192.168.1.20:4500', /loopback/],
    ['http://example.com:4500', /loopback/],
    ['http://localhost:4500', /127\.0\.0\.1/],
    ['https://127.0.0.1:4500', /loopback/],
    ['http://127.0.0.1:4500/api', /loopback/],
    ['http://user:secret@127.0.0.1:4500', /loopback/],
    ['http://127.0.0.1', /port/],
    ['not a url', /loopback/],
    ['http://127.0.0.1:4138', /4138/],
    ['http://127.0.0.1:27018', /Mongo/],
    ['http://127.0.0.1:1023', /1024/],
    ['http://127.0.0.1:4190', /Fetch standard blocks/],
    ['http://127.0.0.1:5060', /Fetch standard blocks/],
    ['http://127.0.0.1:6000', /Fetch standard blocks/],
    ['http://127.0.0.1:10080', /Fetch standard blocks/],
  ])('refuses the origin %j and changes nothing', async (origin, message) => {
    const world = fakeWorld();
    const error = await upFailure(world, { root: fixtureWorktree(), origin });
    expect(error._tag).toBe('Refused');
    expect(error.message).toMatch(message);
    expect(world.launches).toEqual([]);
  });

  it('accepts a loopback origin on a free port', async () => {
    const { backend } = await upIn(fakeWorld(), {
      root: fixtureWorktree(),
      origin: 'http://127.0.0.1:4500',
    });
    expect(backend).toMatchObject({ origin: 'http://127.0.0.1:4500', port: 4500 });
  });

  it('refuses a port that is in use', async () => {
    const world = fakeWorld();
    world.portsInUse.add(4500);
    const error = await upFailure(world, {
      root: fixtureWorktree(),
      origin: 'http://127.0.0.1:4500',
    });
    expect(error.message).toMatch(/in use/);
  });

  it('never adopts a database that already exists', async () => {
    const root = fixtureWorktree();
    const database = `${worktreePrefix(root)}taken`;
    const world = fakeWorld();
    world.databases.set(database, true);
    const error = await upFailure(world, { root, database });
    expect(error.message).toMatch(/already exists/);
    expect(world.launches).toEqual([]);
    expect(world.dropped).toEqual([]);
  });

  it('fails with a clear error when Mongo is not running', async () => {
    const world = fakeWorld();
    world.mongoDown = true;
    const error = await upFailure(world, { root: fixtureWorktree() });
    expect(error._tag).toBe('MongoFailed');
    expect(world.launches).toEqual([]);
  });

  it('drops the database and starts nothing when the seed fails', async () => {
    const world = fakeWorld();
    world.exitCodes = (launch) => (launch.args[0]?.endsWith('seed.mjs') ? 1 : 0);
    world.sideEffect = (launch) => {
      const name = launch.env.SPLITBOOK_NATIVE_DATABASE;
      if (name) world.databases.set(name, true);
    };
    const root = fixtureWorktree();
    const error = await upFailure(world, { root });
    expect(error._tag).toBe('ProcessFailed');
    expect(error.message).toMatch(/seed/i);
    expect(world.launches.map((launch) => launch.args[0])).not.toContainEqual(
      expect.stringMatching(/start\.mjs$/),
    );
    expect(world.dropped).toHaveLength(1);
    expect(readBackend(root)).toBeUndefined();
  });

  it('stops a backend that never becomes ready after the timeout, drops its database, and says so', async () => {
    const world = fakeWorld();
    world.answers = () => false;
    const root = fixtureWorktree();

    const error = await upFailure(world, { root, readyTimeout: '200 millis' });

    expect(error._tag).toBe('ProcessFailed');
    expect(error.message).toMatch(/not ready after 0\.2 s/);
    expect(world.lines).toContain('Stopped the backend at http://127.0.0.1:53001.');
    expect(world.lines.some((line) => /^Dropped splitbook_mobile_swarm_/.test(line))).toBe(true);
    expect(world.stopped).toHaveLength(1);
    expect(world.running.size).toBe(0);
    expect(world.dropped).toHaveLength(1);
    expect(world.databases.size).toBe(0);
    expect(existsSync(statePath(root))).toBe(false);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  it('keeps the record when the database cannot be dropped after a failed start, so down can finish', async () => {
    const world = fakeWorld();
    world.answers = () => false;
    const root = fixtureWorktree();
    world.sideEffect = (launch) => {
      const name = launch.env.SPLITBOOK_NATIVE_DATABASE;
      if (name) {
        world.databases.set(name, true);
        world.failingDrops.add(name);
      }
    };

    await upFailure(world, { root, readyTimeout: '100 millis' });

    expect(world.lines.some((line) => /^Could not drop .*pnpm swarm down/.test(line))).toBe(true);
    expect(readBackend(root)?.mongoPort).toBe(27018);
    expect(world.databases.size).toBe(1);
  });

  it('fails at once when the backend exits before it is ready', async () => {
    const world = fakeWorld();
    world.answers = () => false;
    const root = fixtureWorktree();
    const fiber = Effect.runFork(
      Effect.flip(up({ root, readyTimeout: '1 minute' })).pipe(Effect.provide(fakeLayer(world))),
    );
    await until(() => world.running.size === 1);
    world.running.clear();

    const error = await Effect.runPromise(Fiber.join(fiber));

    expect(error.message).toMatch(/exited before it was ready/);
    expect(world.dropped).toHaveLength(1);
  });

  it('stops the backend it started and drops its database when interrupted', async () => {
    const world = fakeWorld();
    world.answers = () => false;
    const root = fixtureWorktree();
    const fiber = Effect.runFork(
      up({ root, readyTimeout: '1 minute' }).pipe(Effect.provide(fakeLayer(world))),
    );
    await until(() => world.running.size === 1);

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(world.running.size).toBe(0);
    expect(world.stopped).toHaveLength(1);
    expect(world.dropped).toHaveLength(1);
    expect(world.databases.size).toBe(0);
    expect(existsSync(statePath(root))).toBe(false);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  it('checks its flags before cleaning up after an old backend', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const old = `${worktreePrefix(root)}old`;
    world.databases.set(old, true);
    recordBackend(root, { database: old });

    const error = await upFailure(world, { root, origin: 'http://127.0.0.1:4138' });

    expect(error.message).toMatch(/4138/);
    expect(world.dropped).toEqual([]);
    expect(readBackend(root)?.database).toBe(old);
  });
});

describe('one swarm command at a time per worktree', () => {
  it('refuses up while another command holds the lock, and leaves its backend alone', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const first = await upIn(world, { root });
    // Another up, still starting: it holds the lock and its backend doesn't answer yet.
    world.startTimes.set(4999, 'Sun Oct  4 08:00:00 2026');
    holdLock(root, { pid: 4999, started: 'Sun Oct  4 08:00:00 2026', command: 'up' });
    world.answers = () => false;

    const error = await upFailure(world, { root });

    expect(error._tag).toBe('Refused');
    expect(error.message).toMatch(/Another pnpm swarm up \(pid 4999\) is running/);
    expect(world.stopped).toEqual([]);
    expect(world.dropped).toEqual([]);
    expect(world.running.has(first.backend.pid ?? -1)).toBe(true);
    expect(existsSync(lockPath(root))).toBe(true);
  });

  it('refuses down while another command holds the lock', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    await upIn(world, { root });
    world.startTimes.set(4999, 'then');
    holdLock(root, { pid: 4999, started: 'then', command: 'gate' });

    const error = await downFailure(world, { root });

    expect(error.message).toMatch(/Another pnpm swarm gate/);
    expect(world.stopped).toEqual([]);
    expect(world.dropped).toEqual([]);
  });

  it.each([
    ['whose process is gone', undefined],
    ['whose pid now belongs to a later process', 'a later start'],
  ])('replaces a lock %s', async (_case, laterStart) => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    if (laterStart) world.startTimes.set(4999, laterStart);
    holdLock(root, { pid: 4999, started: 'Sun Oct  4 08:00:00 2026', command: 'up' });

    const { reused } = await upIn(world, { root });

    expect(reused).toBe(false);
    expect(existsSync(lockPath(root))).toBe(false);
  });
});

describe('a backend that is running but not answering', () => {
  it('is waited for and reused, never torn down', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const first = await upIn(world, { root });
    let polls = 0;
    world.answers = () => (polls += 1) > 3;

    const again = await upIn(world, { root, readyTimeout: '5 seconds' });

    expect(again).toEqual({ backend: first.backend, reused: true });
    expect(world.stopped).toEqual([]);
    expect(world.dropped).toEqual([]);
  });

  it('is cleaned up like any stale record when it exits while being waited for', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const first = await upIn(world, { root });
    const pid = first.backend.pid ?? -1;
    let polls = 0;
    world.answers = (url) => {
      polls += 1;
      if (polls === 3) {
        world.running.delete(pid);
        world.listening.delete(pid);
      }
      return polls > 3 && [...world.listening.values()].includes(new URL(url).port);
    };

    const second = await upIn(world, { root, readyTimeout: '5 seconds' });

    expect(second.reused).toBe(false);
    expect(world.dropped).toEqual([first.backend.database]);
    expect(second.backend.database).not.toBe(first.backend.database);
  });

  it('is refused after the timeout, and left running with its database', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const first = await upIn(world, { root });
    world.answers = () => false;

    const error = await upFailure(world, { root, readyTimeout: '300 millis' });

    expect(error._tag).toBe('Refused');
    expect(error.message).toMatch(/running but has not answered/);
    expect(world.stopped).toEqual([]);
    expect(world.dropped).toEqual([]);
    expect(world.running.has(first.backend.pid ?? -1)).toBe(true);
    expect(readBackend(root)?.database).toBe(first.backend.database);
  });
});

describe('down', () => {
  it("stops the worktree's backend and drops its own databases, and nothing else", async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const { backend } = await upIn(world, { root });
    const leftover = `${worktreePrefix(root)}leftover`;
    const others = [
      'splitbook_mobile_50',
      'splitbook_mobile_186',
      'splitbook_mobile_swarm_0123456789_theirs',
      'splitbook-demo',
      'splitbook',
      'admin',
    ];
    world.databases.set(leftover, true);
    for (const name of others) world.databases.set(name, true);

    const result = await downIn(world, { root });

    expect(result.stopped).toBe(backend.pid);
    expect(world.running.size).toBe(0);
    expect([...result.dropped].sort()).toEqual([backend.database, leftover].sort());
    expect([...world.databases.keys()].sort()).toEqual([...others].sort());
    expect(readBackend(root)).toBeUndefined();
  });

  it('does nothing when the worktree has no backend and no databases', async () => {
    const world = fakeWorld();
    world.databases.set('splitbook_mobile_50', true);
    const result = await downIn(world, { root: fixtureWorktree() });
    expect(result).toEqual({ stopped: undefined, dropped: [], skipped: [] });
    expect(world.dropped).toEqual([]);
  });

  it.each([
    ['splitbook_mobile_50', /shared fictional backend/],
    ['splitbook-demo', /demo database/],
    ['splitbook_mobile_186', /splitbook_mobile_swarm_/],
    ['splitbook_mobile_swarm_0123456789_theirs', /another worktree/],
  ])('refuses a record naming %j, and stops and drops nothing', async (database, message) => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    world.databases.set(database, true);
    world.running.set(4321, `node ${startScript(root)}`);
    recordBackend(root, { database });

    const error = await downFailure(world, { root });

    expect(error._tag).toBe('Refused');
    expect(error.message).toMatch(message);
    expect(world.dropped).toEqual([]);
    expect(world.stopped).toEqual([]);
    expect(world.databases.has(database)).toBe(true);
  });

  it('refuses a record on port 4138 and never stops the shared backend', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    world.running.set(4321, `node ${startScript(root)}`);
    recordBackend(root, { origin: 'http://127.0.0.1:4138', port: 4138 });

    const error = await downFailure(world, { root });

    expect(error.message).toMatch(/4138/);
    expect(world.stopped).toEqual([]);
  });

  it("never stops a process that isn't this worktree's backend", async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    // Another worktree's backend, or the shared one, now has the recorded pid.
    world.running.set(4321, 'node /elsewhere/apps/mobile/scripts/dev-backend/start.mjs');
    const database = `${worktreePrefix(root)}recorded`;
    world.databases.set(database, true);
    recordBackend(root, { database });

    const result = await downIn(world, { root });

    expect(result.stopped).toBeUndefined();
    expect(world.stopped).toEqual([]);
    expect(result.dropped).toEqual([database]);
  });

  it('leaves a database with its prefix but no ownership marker in place, with a warning, and drops the rest', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const unmarked = `${worktreePrefix(root)}unmarked`;
    const marked = `${worktreePrefix(root)}marked`;
    world.databases.set(unmarked, false);
    world.databases.set(marked, true);

    const result = await downIn(world, { root });

    expect(result.dropped).toEqual([marked]);
    expect(result.skipped).toEqual([unmarked]);
    expect(world.databases.has(unmarked)).toBe(true);
    expect(world.lines.some((line) => line.startsWith(`Warning: left ${unmarked}`))).toBe(true);
  });

  it("stops what is left of the backend's group when its leader died, if it all traces to this worktree", async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const database = `${worktreePrefix(root)}recorded`;
    world.databases.set(database, true);
    recordBackend(root, { database });
    // start.mjs was killed; next dev and next-server live on in its group.
    world.members.set(4321, [
      { pid: 4322, ppid: 1, command: `node ${root}/apps/web/node_modules/next/dist/bin/next dev` },
      { pid: 4323, ppid: 4322, command: 'next-server (v16.1.6)' },
    ]);

    const result = await downIn(world, { root });

    expect(result.stopped).toBe(4321);
    expect(world.stopped).toEqual([4321]);
    expect(world.members.has(4321)).toBe(false);
    expect(result.dropped).toEqual([database]);
  });

  it('leaves a leaderless group alone when one of its processes does not trace to this worktree', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    recordBackend(root, {});
    // A next-server, but not this worktree's: another port, another directory.
    world.members.set(4321, [{ pid: 4323, ppid: 1, command: 'next-server (v16.1.6)' }]);
    world.details.set(4323, { cwd: '/elsewhere/apps/web', listening: [53999] });

    const result = await downIn(world, { root });

    expect(result.stopped).toBeUndefined();
    expect(world.stopped).toEqual([]);
    expect(world.lines.some((line) => line.startsWith('Left process group 4321 alone'))).toBe(true);
  });

  it.each([
    ['listens on the recorded port', { cwd: undefined, listening: [53001] }],
    ['runs in this worktree’s apps/web', { cwd: 'apps/web', listening: [] }],
  ])(
    'stops a production server whose start.mjs died, when its next-server %s',
    async (_case, details) => {
      const root = fixtureWorktree();
      const world = fakeWorld();
      const database = `${worktreePrefix(root)}recorded`;
      world.databases.set(database, true);
      recordBackend(root, { database, server: 'production' });
      // next start retitles its only process, so its command line names no path.
      world.members.set(4321, [{ pid: 4323, ppid: 1, command: 'next-server (v16.1.6)      ' }]);
      world.details.set(4323, {
        cwd: details.cwd === undefined ? undefined : join(root, details.cwd),
        listening: details.listening,
      });
      world.portsInUse.add(53001);

      const result = await downIn(world, { root });

      expect(result.stopped).toBe(4321);
      expect(world.stopped).toEqual([4321]);
      expect(result.dropped).toEqual([database]);
      expect(readBackend(root)).toBeUndefined();
    },
  );

  it('drops nothing and keeps the record while a process it can’t account for holds the recorded port', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const database = `${worktreePrefix(root)}recorded`;
    world.databases.set(database, true);
    recordBackend(root, { database, server: 'production' });
    // A next-server the tool can't place (no working directory or ports), with the
    // recorded port taken.
    world.members.set(4321, [{ pid: 4323, ppid: 1, command: 'next-server (v16.1.6)' }]);
    world.portsInUse.add(53001);

    const error = await downFailure(world, { root });

    expect(error._tag).toBe('Refused');
    expect(error.message).toMatch(/^Dropped nothing: process group 4321 .*\(4323\).*port 53001/);
    expect(world.stopped).toEqual([]);
    expect(world.dropped).toEqual([]);
    expect(readBackend(root)?.database).toBe(database);
    // up refuses too, rather than replace the record.
    expect((await upFailure(world, { root })).message).toMatch(/^Dropped nothing/);

    // Once that process is gone and the port is free, down finishes.
    world.members.delete(4321);
    world.portsInUse.delete(53001);
    const result = await downIn(world, { root });
    expect(result.dropped).toEqual([database]);
    expect(readBackend(root)).toBeUndefined();
  });

  it('never stops a process with the same command line that started later, such as a reused pid', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    world.running.set(4321, `node ${startScript(root)}`);
    world.startTimes.set(4321, 'a later start');
    recordBackend(root, {});

    const result = await downIn(world, { root });

    expect(result.stopped).toBeUndefined();
    expect(world.stopped).toEqual([]);
  });

  it('reports a drop that fails and keeps the record, so it can run again', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    const failing = `${worktreePrefix(root)}failing`;
    const other = `${worktreePrefix(root)}other`;
    world.databases.set(failing, true);
    world.databases.set(other, true);
    world.failingDrops.add(failing);
    recordBackend(root, { database: failing });

    const error = await downFailure(world, { root });

    expect(error._tag).toBe('MongoFailed');
    expect(error.message).toMatch(/is kept/);
    expect(world.dropped).toEqual([other]);
    expect(readBackend(root)?.database).toBe(failing);
  });

  it('keeps its record when Mongo is not running, so it can run again', async () => {
    const root = fixtureWorktree();
    const world = fakeWorld();
    await upIn(world, { root });
    world.mongoDown = true;

    const error = await downFailure(world, { root });

    expect(error._tag).toBe('MongoFailed');
    expect(readBackend(root)).toBeDefined();
  });
});
