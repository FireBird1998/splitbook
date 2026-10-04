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
import { fetchBlockedPorts, statePath, up } from './backend.ts';
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
});
