/**
 * The commands on real processes: stand-in backend scripts that never become ready and
 * start a child of their own, as `next dev` does. Mongo stays a fake; nothing here
 * needs a database server.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Effect, Fiber, Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchBlockedPorts, statePath, up } from './backend.ts';
import { gate, verdictPath, type Verdict } from './gate.ts';
import { DatabasesLive, fictionalMarker, ProcessesLive, NetworkLive } from './live.ts';
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
    expect(world.dropped).toHaveLength(1);
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
    expect(world.dropped).toHaveLength(1);
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

    const verdict = await Effect.runPromise(
      gate({ root, stepTimeout: '3 seconds', readyTimeout: '1 second' }).pipe(provide),
    );

    expect(processesWith(marker)).toEqual([]);
    expect(verdict.steps.find((step) => step.name === 'lint')?.detail).toMatch(/timed out/);
    expect(verdict.steps.find((step) => step.name === 'typecheck')?.status).toBe('pass');
    expect(verdict.steps.find((step) => step.name === 'format check')?.detail).toBe('exit code 3');
  }, 60_000);
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

  it.each(['splitbook_mobile_50', 'splitbook-demo', 'splitbook_mobile_186', 'admin'])(
    'refuse to drop %j without connecting to Mongo',
    async (name) => {
      // Port 1 has no Mongo: a connection attempt would fail as MongoFailed, not Refused.
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.gen(function* () {
            return yield* (yield* Databases).drop(1, name);
          }),
        ).pipe(Effect.provide(DatabasesLive)),
      );
      expect(error._tag).toBe('Refused');
    },
  );

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

  it('reads the command line of a running process, and nothing for one that is gone', async () => {
    const lines = await Effect.runPromise(
      Effect.gen(function* () {
        const processes = yield* Processes;
        return [yield* processes.commandLine(process.pid), yield* processes.commandLine(2 ** 22)];
      }).pipe(Effect.provide(ProcessesLive)),
    );
    expect(lines[0]).toContain('node');
    expect(lines[1]).toBeUndefined();
  });
});
