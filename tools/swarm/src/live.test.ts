/**
 * The commands on real processes: stand-in backend scripts that never become ready and
 * start a child of their own, as `next dev` does. Mongo stays a fake; nothing here
 * needs a database server.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Effect, Fiber, Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { down, fetchBlockedPorts, statePath, up } from './backend.ts';
import { gate, verdictPath, type Verdict } from './gate.ts';
import { DatabasesLive, ProcessesLive, NetworkLive } from './live.ts';
import { fictionalMarker, guardedDrop, worktreePrefix, type DatabaseHandle } from './names.ts';
import { Databases, Network, Output, Processes } from './platform.ts';
import { fakeLayer, fakeWorld, fixtureWorktree, removeFixtures, until } from './test-fakes.ts';

afterEach(removeFixtures);

/** Every process whose command line carries the marker. */
function processesWith(marker: string): string[] {
  return execFileSync('ps', ['-A', '-o', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(marker) && !line.includes('ps -A'));
}

/** Runs what follows in this time zone and locale, as a shell with TZ and LC_ALL set would; returns the undo. */
function zone(TZ: string, LC_ALL: string) {
  const before = { TZ: process.env.TZ, LC_ALL: process.env.LC_ALL };
  Object.assign(process.env, { TZ, LC_ALL });
  return () => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

/** A backend start script that never answers and keeps a child running, like next dev. */
const neverReady = (marker: string) => `
import { spawn } from 'node:child_process';
spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '${marker}'], { stdio: 'ignore' });
setInterval(() => {}, 1000);
`;

/** Real processes and network; the fake world's Mongo and output. */
function realProcesses() {
  const world = fakeWorld();
  const provide = <A, E>(effect: Effect.Effect<A, E, Processes | Databases | Network | Output>) =>
    effect.pipe(
      Effect.provide(Layer.mergeAll(ProcessesLive, NetworkLive)),
      Effect.provide(fakeLayer(world)),
    );
  return { world, provide };
}

describe('on real processes', () => {
  it('stops a backend that never becomes ready, with the processes it started, after the timeout', async () => {
    const marker = `swarm-test-${randomUUID()}`;
    const root = fixtureWorktree({
      'apps/mobile/scripts/dev-backend/start.mjs': neverReady(marker),
    });
    const { world, provide } = realProcesses();

    const error = await Effect.runPromise(
      Effect.flip(up({ root, readyTimeout: '1500 millis' })).pipe(provide),
    );

    expect(error.message).toMatch(/not ready after 1\.5 s/);
    expect(processesWith(marker)).toEqual([]);
    // The stand-in seed creates no database, so there is nothing to drop; the record goes.
    expect(world.dropped).toEqual([]);
    expect(existsSync(statePath(root))).toBe(false);
  }, 20_000);

  it('stops the backend and its children when up is interrupted', async () => {
    const marker = `swarm-test-${randomUUID()}`;
    const root = fixtureWorktree({
      'apps/mobile/scripts/dev-backend/start.mjs': neverReady(marker),
    });
    const { world, provide } = realProcesses();
    const fiber = Effect.runFork(up({ root, readyTimeout: '1 minute' }).pipe(provide));
    await until(() => processesWith(marker).length > 0, 10_000);

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(processesWith(marker)).toEqual([]);
    // The stand-in seed creates no database, so there is nothing to drop; the record goes.
    expect(world.dropped).toEqual([]);
    expect(existsSync(statePath(root))).toBe(false);
  }, 20_000);

  describe('a production backend, whose next start retitles its process next-server (#860)', () => {
    /**
     * As start.mjs with SPLITBOOK_NATIVE_SERVER=production: a child in apps/web that retitles
     * itself as next start does, so its command line names no path, and answers on the port.
     */
    const productionBackend = `
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
if (process.env.SPLITBOOK_NATIVE_SERVER !== 'production') process.exit(2);
const server = [
  "process.title = 'next-server (v0.0.0)';",
  "require('node:http').createServer((_request, response) => response.end('ok'))",
  ".listen(Number(process.env.SPLITBOOK_NATIVE_ORIGIN_PORT), '127.0.0.1');",
  "setInterval(() => {}, 1000); // ${'.'.repeat(80)}",
].join('');
const child = spawn(process.execPath, ['-e', server], {
  cwd: resolve(import.meta.dirname, '../../../web'),
  stdio: 'ignore',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
`;

    const groupOf = (pid: number) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* Processes).group(pid);
        }).pipe(Effect.provide(ProcessesLive)),
      );
    const portFree = (port: number) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* Network).isPortFree(port);
        }).pipe(Effect.provide(NetworkLive)),
      );

    it.each([
      ['when up and down run in different time zones and locales', false],
      ['when its start.mjs was killed', true],
    ])(
      'down stops it and frees its port %s',
      async (_case, killLeader) => {
        const root = fixtureWorktree({
          'apps/mobile/scripts/dev-backend/start.mjs': productionBackend,
          'apps/web/.keep': '',
        });
        const { world, provide } = realProcesses();
        // As implementer 2 ran it for #849: TZ=UTC pnpm swarm up --server production.
        let restore = zone('UTC', 'C');
        let pid = -1;
        try {
          const { backend } = await Effect.runPromise(
            up({ root, server: 'production', readyTimeout: '20 seconds' }).pipe(provide),
          );
          pid = backend.pid ?? -1;
          expect((await groupOf(pid)).map((member) => member.command)).toContainEqual(
            expect.stringMatching(/^next-server \(v0\.0\.0\)/),
          );
          if (killLeader) {
            process.kill(pid, 'SIGKILL');
            await until(() => !processesWith(`${root}/apps/mobile`).length, 10_000);
          }
          restore();
          // Then pnpm swarm down from a shell in another zone, such as the machine's own.
          restore = zone('Asia/Kolkata', 'en_US.UTF-8');

          const result = await Effect.runPromise(down({ root }).pipe(provide));

          expect(result.stopped).toBe(pid);
          expect(await groupOf(pid)).toEqual([]);
          expect(await portFree(backend.port)).toBe(true);
          expect(existsSync(statePath(root))).toBe(false);
          expect(world.lines.join('\n')).not.toMatch(/Left process group/);
        } finally {
          restore();
          if (pid > 1) {
            try {
              process.kill(-pid, 'SIGKILL');
            } catch {
              // Already gone.
            }
          }
        }
      },
      40_000,
    );
  });

  it("stops a running step's whole process group when the gate is interrupted", async () => {
    const marker = `swarm-test-${randomUUID()}`;
    const root = fixtureWorktree({
      'package.json': JSON.stringify({
        name: 'swarm-fixture',
        private: true,
        scripts: { lint: `node -e "setInterval(() => {}, 1000)" ${marker}` },
      }),
    });
    const { provide } = realProcesses();
    const fiber = Effect.runFork(gate({ root }).pipe(provide));
    await until(() => processesWith(marker).length > 0, 15_000);

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(processesWith(marker)).toEqual([]);
    const verdict = JSON.parse(readFileSync(verdictPath(root), 'utf8')) as Verdict;
    expect(verdict).toMatchObject({ verdict: 'fail', interrupted: true });
  }, 30_000);

  it('stops a step at its timeout with everything it started', async () => {
    const marker = `swarm-test-${randomUUID()}`;
    const root = fixtureWorktree({
      'package.json': JSON.stringify({
        name: 'swarm-fixture',
        private: true,
        scripts: {
          lint: `node -e "setInterval(() => {}, 1000)" ${marker}`,
          typecheck: 'node -e "process.exit(0)"',
          'format:check': 'node -e "process.exit(3)"',
          'test:unit': 'node -e "process.exit(0)"',
        },
      }),
    });
    const { provide } = realProcesses();

    // Long enough for pnpm's cold start on a loaded runner; only lint is meant to time out.
    const verdict = await Effect.runPromise(
      gate({ root, stepTimeout: '8 seconds', readyTimeout: '1 second' }).pipe(provide),
    );

    expect(processesWith(marker)).toEqual([]);
    expect(verdict.steps.find((step) => step.name === 'lint')?.detail).toMatch(/timed out/);
  }, 90_000);
});

describe('the live services', () => {
  it("refuse every port Node's fetch blocks, which the verifiers' requests would never reach", async () => {
    // A dispatcher that fails whatever it is handed: nothing is ever sent. A blocked port
    // fails with "bad port" before fetch reaches the dispatcher.
    const neverSends = {
      dispatch(_options: unknown, handler: { onError: (error: Error) => void }) {
        queueMicrotask(() => handler.onError(new Error('not sent')));
        return true;
      },
    };
    const blockedByNode: number[] = [];
    for (let port = 1; port <= 65535; port += 1) {
      const cause = await fetch(`http://127.0.0.1:${port}/`, {
        dispatcher: neverSends,
      } as RequestInit).then(
        () => undefined,
        (error: Error) => (error.cause as Error | undefined)?.message,
      );
      if (cause === 'bad port') blockedByNode.push(port);
      else expect(cause).toBe('not sent');
    }
    expect(blockedByNode).toContain(4190);
    expect(blockedByNode.filter((port) => !fetchBlockedPorts.has(port))).toEqual([]);
  }, 60_000);

  const ownPrefix = worktreePrefix('/fictional/worktree');
  it.each([
    ['splitbook_mobile_50', ownPrefix],
    ['splitbook-demo', ownPrefix],
    ['splitbook_mobile_186', ownPrefix],
    ['admin', ownPrefix],
    [`${worktreePrefix('/another/worktree')}abc`, ownPrefix],
    [`${ownPrefix}ABC`, ownPrefix],
    ['splitbook_mobile_swarm_abc', 'splitbook_mobile_swarm_'],
    ['splitbook_mobile_50', 'splitbook_mobile_'],
  ])('refuse to drop %j for the prefix %j without connecting to Mongo', async (name, prefix) => {
    // Port 1 has no Mongo: a connection attempt would fail as MongoFailed, not Refused.
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.gen(function* () {
          return yield* (yield* Databases).drop(1, name, prefix);
        }),
      ).pipe(Effect.provide(DatabasesLive)),
    );
    expect(error._tag).toBe('Refused');
  });

  describe('drop the database behind the guard only', () => {
    const handle = (exists: boolean, fictional: boolean) => {
      const calls: string[] = [];
      const database: DatabaseHandle = {
        exists: async () => (calls.push('exists'), exists),
        isFictional: async () => (calls.push('isFictional'), fictional),
        drop: async () => void calls.push('drop'),
      };
      return {
        calls,
        withDatabase: <A>(use: (db: DatabaseHandle) => Promise<A>) =>
          Effect.promise(() => use(database)),
      };
    };

    it('refuses a database without the ownership marker and leaves it', async () => {
      const { calls, withDatabase } = handle(true, false);
      const error = await Effect.runPromise(
        Effect.flip(guardedDrop(`${ownPrefix}abc`, ownPrefix, withDatabase)),
      );
      expect(error._tag).toBe('Refused');
      expect(error.message).toMatch(/ownership marker/);
      expect(calls).not.toContain('drop');
    });

    it("never looks inside another worktree's database", async () => {
      const { calls, withDatabase } = handle(true, true);
      const error = await Effect.runPromise(
        Effect.flip(
          guardedDrop(`${worktreePrefix('/another/worktree')}abc`, ownPrefix, withDatabase),
        ),
      );
      expect(error.message).toMatch(/only this worktree's databases/);
      expect(calls).toEqual([]);
    });

    it('drops a marked database with this worktree prefix, and reports one that is gone', async () => {
      const marked = handle(true, true);
      expect(
        await Effect.runPromise(guardedDrop(`${ownPrefix}abc`, ownPrefix, marked.withDatabase)),
      ).toBe('dropped');
      expect(marked.calls).toEqual(['exists', 'isFictional', 'drop']);
      const gone = handle(false, false);
      expect(
        await Effect.runPromise(guardedDrop(`${ownPrefix}abc`, ownPrefix, gone.withDatabase)),
      ).toBe('absent');
      expect(gone.calls).toEqual(['exists']);
    });
  });

  it("knows the fictional backend's ownership marker", () => {
    const environment = readFileSync(
      resolve(import.meta.dirname, '../../../apps/mobile/scripts/dev-backend/environment.mjs'),
      'utf8',
    );
    expect(environment).toContain(`export const marker = '${fictionalMarker}';`);
  });

  it('hands out loopback ports that are free', async () => {
    const free = await Effect.runPromise(
      Effect.gen(function* () {
        const network = yield* Network;
        const port = yield* network.freePort;
        return { port, free: yield* network.isPortFree(port) };
      }).pipe(Effect.provide(NetworkLive)),
    );
    expect(free.port).toBeGreaterThan(1023);
    expect(free.port).not.toBe(4138);
    expect(free.free).toBe(true);
  });

  it("reads a process's start time and its group's members, and nothing for one that is gone", async () => {
    const marker = `swarm-test-${randomUUID()}`;
    const child = spawn(
      process.execPath,
      [
        '-e',
        `require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '${marker}'], { stdio: 'ignore' }); setInterval(() => {}, 1000)`,
        marker,
      ],
      { detached: true, stdio: 'ignore' },
    );
    const pid = child.pid ?? -1;
    try {
      await until(() => processesWith(marker).length === 2, 10_000);
      const seen = await Effect.runPromise(
        Effect.gen(function* () {
          const processes = yield* Processes;
          return {
            started: yield* processes.startTime(pid),
            again: yield* processes.startTime(pid),
            gone: yield* processes.startTime(2 ** 22),
            members: yield* processes.group(pid),
          };
        }).pipe(Effect.provide(ProcessesLive)),
      );
      expect(seen.started).toMatch(/\d{1,2}:\d{2}:\d{2}/);
      expect(seen.again).toBe(seen.started);
      expect(seen.gone).toBeUndefined();
      expect(seen.members.map((member) => member.pid)).toContain(pid);
      expect(seen.members).toHaveLength(2);
      expect(seen.members.every((member) => member.command.includes(marker))).toBe(true);
    } finally {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
    await until(() => processesWith(marker).length === 0, 10_000);
  }, 30_000);

  it('reads the same start time, in UTC, whatever time zone and locale the command runs in (#860)', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    const startTime = () =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* Processes).startTime(child.pid ?? -1);
        }).pipe(Effect.provide(ProcessesLive)),
      );
    const readIn = async (TZ: string, LC_ALL: string) => {
      const restore = zone(TZ, LC_ALL);
      try {
        return await startTime();
      } finally {
        restore();
      }
    };
    try {
      const utc = await readIn('UTC', 'C');
      expect(utc).toMatch(/^\w{3} \w{3} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/);
      expect(Math.abs(Date.parse(`${utc} UTC`) - Date.now())).toBeLessThan(60_000);
      expect(await readIn('Asia/Kolkata', 'de_DE.UTF-8')).toBe(utc);
      expect(await readIn('Pacific/Kiritimati', 'fr_FR.UTF-8')).toBe(utc);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it("reads a process's working directory and the port it listens on, as down needs for a lone next-server", async () => {
    const cwd = fixtureWorktree();
    const child = spawn(
      process.execPath,
      [
        '-e',
        "require('node:net').createServer().listen(0, '127.0.0.1', function () { console.log(this.address().port) })",
      ],
      { cwd, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    try {
      const port = Number(
        await new Promise<string>((resolve) =>
          child.stdout.once('data', (chunk) => resolve(String(chunk).trim())),
        ),
      );
      const details = await Effect.runPromise(
        Effect.gen(function* () {
          const processes = yield* Processes;
          return {
            running: yield* processes.details(child.pid ?? -1),
            gone: yield* processes.details(2 ** 22),
          };
        }).pipe(Effect.provide(ProcessesLive)),
      );
      expect(details.running.cwd).toBe(cwd);
      // The ports come from lsof; without it (some Linux machines) only the directory is known.
      expect(details.running.listening).toEqual(hasLsof() ? [port] : []);
      expect(details.gone).toEqual({ cwd: undefined, listening: [] });
    } finally {
      child.kill('SIGKILL');
    }
  }, 30_000);
});

function hasLsof(): boolean {
  try {
    execFileSync('sh', ['-c', 'command -v lsof'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
