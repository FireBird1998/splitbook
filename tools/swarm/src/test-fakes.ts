/**
 * Fakes for the commands' tests: an in-memory Mongo server, processes that only record
 * what they were asked to do, and a network whose answers the test decides. Each fake
 * keeps what happened, so a test asserts on behaviour, never on the commands' internals.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect, Layer } from 'effect';
import { guardedDrop } from './names.ts';
import {
  Databases,
  MongoFailed,
  Network,
  Output,
  Processes,
  ProcessFailed,
  type Finished,
  type GroupMember,
  type Launch,
  type ProcessDetails,
} from './platform.ts';

export interface FakeWorld {
  /** Database name -> whether it holds the fictional ownership marker. */
  readonly databases: Map<string, boolean>;
  readonly dropped: string[];
  /** Databases whose drop fails as if Mongo went away mid-way. */
  readonly failingDrops: Set<string>;
  mongoDown: boolean;
  /** Every process started (detached) or run to completion, in order. */
  readonly launches: Launch[];
  /** pid -> command line, for processes still running. Each leads its own group. */
  readonly running: Map<number, string>;
  /**
   * pid -> start time, where it differs from the default (`started <pid>` for a running
   * process): a reused pid, or a lock holder that isn't one of the fake's processes.
   */
  readonly startTimes: Map<number, string>;
  /** pgid -> processes left in a group besides its leader, such as next-server. */
  readonly members: Map<number, GroupMember[]>;
  /** pid -> working directory and listening ports. Default: unknown. */
  readonly details: Map<number, ProcessDetails>;
  readonly stopped: number[];
  nextPid: number;
  /** Exit code of a run process, by the script or command it runs. Default 0. */
  exitCodes: (launch: Launch) => number | 'hang';
  /** What a run process does before it exits, such as the seed creating its database. */
  sideEffect: (launch: Launch) => void;
  /** The free ports the operating system hands out, in order. */
  readonly freePorts: number[];
  readonly portsInUse: Set<number>;
  /** Whether a URL answers. Default: the origin of a started backend that is still running. */
  answers: (url: string) => boolean;
  /** pid -> origin port, for started processes that were given one. */
  readonly listening: Map<number, string>;
  /** stdout of short commands such as git, by "command arg arg". */
  readonly outputs: Map<string, string>;
  readonly lines: string[];
}

export function fakeWorld(): FakeWorld {
  const world: FakeWorld = {
    databases: new Map(),
    dropped: [],
    failingDrops: new Set(),
    mongoDown: false,
    launches: [],
    running: new Map(),
    startTimes: new Map(),
    members: new Map(),
    details: new Map(),
    stopped: [],
    nextPid: 4100,
    exitCodes: () => 0,
    sideEffect: (launch) => {
      // The real seed claims its database with the ownership marker first.
      if (launch.args.some((arg) => arg.endsWith('/seed.mjs'))) {
        const name = launch.env.SPLITBOOK_NATIVE_DATABASE;
        if (name) world.databases.set(name, true);
      }
    },
    freePorts: [53001, 53002, 53003, 53004, 53005],
    portsInUse: new Set(),
    answers: (url) => [...world.listening.values()].includes(new URL(url).port),
    listening: new Map(),
    outputs: new Map(),
    lines: [],
  };
  return world;
}

export function fakeLayer(world: FakeWorld) {
  const mongo = <A>(action: () => A) =>
    world.mongoDown
      ? Effect.fail(new MongoFailed({ message: 'No Mongo server answered on 127.0.0.1.' }))
      : Effect.sync(action);
  return Layer.mergeAll(
    Layer.succeed(Databases, {
      list: () => mongo(() => [...world.databases.keys()]),
      // The same guard as the live service, over the in-memory server.
      drop: (_port, name, prefix) =>
        guardedDrop(name, prefix, (use) =>
          world.failingDrops.has(name)
            ? Effect.fail(
                new MongoFailed({ message: `The connection closed while dropping ${name}.` }),
              )
            : mongo(() => undefined).pipe(
                Effect.andThen(
                  Effect.promise(() =>
                    use({
                      exists: async () => world.databases.has(name),
                      isFictional: async () => world.databases.get(name) === true,
                      drop: async () => {
                        world.databases.delete(name);
                        world.dropped.push(name);
                      },
                    }),
                  ),
                ),
              ),
        ),
    }),
    Layer.succeed(Processes, {
      start: (launch) =>
        Effect.sync(() => {
          world.launches.push(launch);
          const pid = world.nextPid++;
          world.running.set(pid, [launch.command, ...launch.args].join(' '));
          const port = launch.env.SPLITBOOK_NATIVE_ORIGIN_PORT;
          if (port) world.listening.set(pid, port);
          return { pid };
        }),
      run: (launch) =>
        Effect.suspend((): Effect.Effect<Finished, ProcessFailed> => {
          world.launches.push(launch);
          const code = world.exitCodes(launch);
          if (code === 'hang') {
            const pid = world.nextPid++;
            world.running.set(pid, [launch.command, ...launch.args].join(' '));
            return Effect.never.pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  world.running.delete(pid);
                  world.stopped.push(pid);
                }),
              ),
            );
          }
          world.sideEffect(launch);
          return Effect.succeed({ exitCode: code });
        }),
      output: (command, args) => Effect.sync(() => world.outputs.get([command, ...args].join(' '))),
      startTime: (pid) =>
        Effect.sync(() =>
          world.running.has(pid)
            ? (world.startTimes.get(pid) ?? `started ${pid}`)
            : pid === process.pid
              ? 'this process'
              : world.startTimes.get(pid),
        ),
      group: (pgid) =>
        Effect.sync(() => [
          ...(world.running.has(pgid)
            ? [{ pid: pgid, ppid: 1, command: world.running.get(pgid) ?? '' }]
            : []),
          ...(world.members.get(pgid) ?? []),
        ]),
      details: (pid) =>
        Effect.sync(() => world.details.get(pid) ?? { cwd: undefined, listening: [] }),
      stopGroup: (pid) =>
        Effect.sync(() => {
          world.running.delete(pid);
          world.listening.delete(pid);
          world.members.delete(pid);
          world.stopped.push(pid);
        }),
    }),
    Layer.succeed(Network, {
      freePort: Effect.sync(() => {
        const port = world.freePorts.shift();
        if (port === undefined) throw new Error('The fake ran out of free ports');
        return port;
      }),
      isPortFree: (port) => Effect.sync(() => !world.portsInUse.has(port)),
      answers: (url) => Effect.sync(() => world.answers(url)),
    }),
    Layer.succeed(Output, { line: (text) => Effect.sync(() => void world.lines.push(text)) }),
  );
}

const fixtures: string[] = [];

/**
 * A directory shaped like a Splitbook worktree, with the files the commands read. The
 * path is resolved, as the commands resolve theirs (macOS links /var to /private/var).
 */
export function fixtureWorktree(files: Record<string, string> = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'swarm-worktree-')));
  fixtures.push(root);
  const lockfile = "lockfileVersion: '9.0'\n";
  const defaults: Record<string, string> = {
    'pnpm-lock.yaml': lockfile,
    'node_modules/.pnpm/lock.yaml': lockfile,
    'apps/mobile/package.json': JSON.stringify({
      scripts: { 'verify:api': 'x', 'verify:financial': 'x', 'verify:all': 'x', test: 'x' },
    }),
    'apps/mobile/scripts/dev-backend/seed.mjs': '',
    'apps/mobile/scripts/dev-backend/start.mjs': '',
  };
  for (const [path, content] of Object.entries({ ...defaults, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

export function removeFixtures() {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
}

/** Waits until the condition holds, polling. */
export async function until(condition: () => boolean, timeoutMs = 2000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('Condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
