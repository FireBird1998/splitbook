/**
 * A fictional backend per worktree: `up` picks a free loopback port and a fresh
 * database with the tool's own prefix, seeds it, starts the backend through #185's
 * variables and waits until it answers. `down` stops it and drops only this worktree's
 * databases.
 *
 * Safety rules, enforced before anything connects or starts:
 * - the origin is http://127.0.0.1:<port>, never port 4138 (the shared backend's) or a
 *   port the Fetch standard blocks;
 * - every database name starts with this worktree's prefix inside splitbook_mobile_swarm_,
 *   so it is never splitbook_mobile_50, a demo database or another worktree's;
 * - `up` never adopts a database that already exists;
 * - one swarm command runs at a time per worktree (lock.ts), and a backend that is still
 *   starting or not answering is never torn down by another command;
 * - a process group is signalled only when its leader is this worktree's own start.mjs with
 *   the recorded start time, or, once that leader is gone, when every process left in it
 *   traces back to this worktree;
 * - every drop goes through one check (names.ts): this worktree's prefix and the fictional
 *   ownership marker.
 *
 * The backend's own scripts keep refusing .env files and build the server's environment
 * themselves; this module passes them only PATH and the SPLITBOOK_NATIVE_* variables.
 */
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Duration, Effect, Exit, type Scope } from 'effect';
import { withWorktreeLock } from './lock.ts';
import { toolPrefix, worktreePrefix } from './names.ts';
import {
  Databases,
  Network,
  Output,
  Processes,
  ProcessFailed,
  Refused,
  MongoFailed,
  type GroupMember,
  type Launch,
  type SwarmError,
} from './platform.ts';

export { toolPrefix, worktreePrefix } from './names.ts';

/** The backend's default Mongo port (apps/mobile/scripts/dev-backend/environment.mjs). */
export const defaultMongoPort = 27018;
/** The shared fictional backend, which the tool never uses. */
const shared = { port: 4138, database: 'splitbook_mobile_50' } as const;
/** The web app's demo and development databases (apps/web/scripts/demo-seed.ts). */
const demoDatabases = ['splitbook', 'splitbook-demo'];
/**
 * The ports the Fetch standard blocks (https://fetch.spec.whatwg.org/#port-blocking).
 * Node's fetch, which the verifiers use, refuses them with "bad port" before connecting,
 * so a backend on one would fail every verifier. As in Node 22's undici; a test checks
 * that Node's fetch blocks no port missing here.
 */
export const fetchBlockedPorts: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);
/** Better Auth's health route: it answers once the server has compiled the auth route. */
const readinessPath = '/api/auth/ok';
const defaultReadyTimeout: Duration.Input = '3 minutes';

/**
 * How start.mjs serves the web app (its SPLITBOOK_NATIVE_SERVER): `next dev`, or a
 * production build for the backend's origin, then `next start`. The build counts toward
 * the ready timeout.
 */
export type ServerMode = 'dev' | 'production';
const serverModes: readonly string[] = ['dev', 'production'] satisfies ServerMode[];
const defaultSeedTimeout: Duration.Input = '2 minutes';

export interface Backend {
  readonly origin: string;
  readonly port: number;
  readonly database: string;
  readonly mongoPort: number;
  readonly log: string;
  /** When `up` (or the gate) began starting it. */
  readonly startedAt: string;
  /** The backend's start.mjs, leader of its process group; undefined while seeding. */
  readonly pid: number | undefined;
  /** When that process started, as `ps -o lstart` prints it, to tell it from a reused pid. */
  readonly processStart: string | undefined;
  /** Seconds from start to the first answer; undefined until it answers. */
  readonly readySeconds: number | undefined;
  /** Missing in a record from before production builds, which means dev. */
  readonly server?: ServerMode;
}

export interface UpOptions {
  /** The worktree's root, resolved. */
  readonly root: string;
  /** Default: http://127.0.0.1 on a port the operating system reports free. */
  readonly origin?: string | undefined;
  /** Default: a fresh name with this worktree's prefix. */
  readonly database?: string | undefined;
  readonly mongoPort?: number | undefined;
  readonly readyTimeout?: Duration.Input | undefined;
  readonly seedTimeout?: Duration.Input | undefined;
  /** `dev` (the default) or `production`. */
  readonly server?: string | undefined;
}

export interface DownOptions {
  readonly root: string;
  /** Default: the recorded backend's Mongo port, else 27018. */
  readonly mongoPort?: number | undefined;
}

export interface DownResult {
  /** The process group that was stopped, if any. */
  readonly stopped: number | undefined;
  readonly dropped: readonly string[];
  /** This worktree's databases left in place: they had no ownership marker. */
  readonly skipped: readonly string[];
}

export const outDirectory = (root: string) => join(root, 'tools/swarm/out');
export const statePath = (root: string) => join(outDirectory(root), 'backend.json');
const backendScript = (root: string, name: 'seed.mjs' | 'start.mjs') =>
  join(root, 'apps/mobile/scripts/dev-backend', name);

/** The variables that point the verifiers and the backend's controls at this backend. */
export function backendVariables(backend: Backend): Record<string, string> {
  return {
    MOBILE_VERIFY_URL: backend.origin,
    SPLITBOOK_NATIVE_ORIGIN_PORT: String(backend.port),
    SPLITBOOK_NATIVE_DATABASE: backend.database,
    SPLITBOOK_NATIVE_MONGO_PORT: String(backend.mongoPort),
  };
}

/** The backend `up` recorded for this worktree, or undefined when there is none. */
export function readBackend(root: string): Backend | undefined {
  let text: string;
  try {
    text = readFileSync(statePath(root), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return JSON.parse(text) as Backend;
}

const fileFailure = (action: string, error: unknown) =>
  new ProcessFailed({
    message: `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`,
  });

const writeBackend = (root: string, backend: Backend) =>
  Effect.try({
    try: () => {
      mkdirSync(dirname(statePath(root)), { recursive: true });
      writeFileSync(statePath(root), `${JSON.stringify(backend, null, 2)}\n`);
    },
    catch: (error) => fileFailure(`write ${statePath(root)}`, error),
  });

const forgetBackend = (root: string) => Effect.sync(() => rmSync(statePath(root), { force: true }));

/** The last lines of a log, without stack frames, to show why something failed. */
export function logTail(path: string, lines = 20): string {
  try {
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(16_384);
      const size = fstatSync(fd).size;
      const read = readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      return (
        buffer
          .subarray(0, read)
          .toString('utf8')
          .trimEnd()
          .split('\n')
          // Stack frames push the error's own line out of a short tail.
          .filter((line) => !/^\s+at\s/.test(line))
          .slice(-lines)
          .join('\n')
      );
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}

/** A message, then the end of the log it points to. */
const withLog = (message: string, log: string) => {
  const lines = logTail(log, 12);
  return lines
    ? `${message}\nThe end of ${log}:\n${lines.replace(/^/gm, '  | ')}`
    : `${message} See ${log}.`;
};

function databaseRefusal(name: string, root: string): string | undefined {
  if (name === shared.database) {
    return `Refusing ${name}: it is the shared fictional backend's database. The tool uses only its own, whose names start with ${toolPrefix}.`;
  }
  if (demoDatabases.includes(name) || (name.includes('demo') && !name.startsWith(toolPrefix))) {
    return `Refusing ${name}: it is a demo database. The tool uses only its own, whose names start with ${toolPrefix}.`;
  }
  if (!name.startsWith(toolPrefix)) {
    return `Refusing ${name}: the tool uses only databases whose names start with ${toolPrefix}.`;
  }
  const own = worktreePrefix(root);
  if (!name.startsWith(own)) {
    return `Refusing ${name}: it belongs to another worktree. This worktree's databases start with ${own}.`;
  }
  if (name.length === own.length || name.length > 63 || !/^[a-z0-9_]+$/.test(name)) {
    return `Refusing ${name}: after ${own} a database name continues with lowercase letters, digits or underscores, 63 characters at most.`;
  }
  return undefined;
}

function portRefusal(port: number, mongoPort: number): string | undefined {
  if (port === shared.port) {
    return `Refusing port ${port}: it is the shared fictional backend's port.`;
  }
  if (port === mongoPort) return `Refusing port ${port}: it is the Mongo port.`;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return `Refusing port ${port}: use a port from 1024 to 65535.`;
  }
  if (fetchBlockedPorts.has(port)) {
    return `Refusing port ${port}: the Fetch standard blocks it, so the verifiers' fetch would refuse it ("bad port").`;
  }
  return undefined;
}

/** The port of a requested origin, which must be a plain loopback origin. */
function requestedPort(origin: string, mongoPort: number): number | string {
  const loopback = `Refusing origin ${origin}: the backend serves only a loopback origin, http://127.0.0.1:<port>.`;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return loopback;
  }
  if (url.hostname === 'localhost' || url.hostname === '[::1]') {
    return `Refusing origin ${origin}: the backend listens on 127.0.0.1 only. Use http://127.0.0.1:<port>.`;
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    return loopback;
  }
  if (!url.port) return `Refusing origin ${origin}: name its port, as in http://127.0.0.1:4500.`;
  const port = Number(url.port);
  return portRefusal(port, mongoPort) ?? port;
}

function mongoPortRefusal(mongoPort: number): string | undefined {
  return Number.isInteger(mongoPort) && mongoPort > 0 && mongoPort <= 65535
    ? undefined
    : `Refusing Mongo port ${mongoPort}: use a TCP port from 1 to 65535.`;
}

/** Why a recorded backend may not be stopped or dropped, if it may not. */
function recordRefusal(record: Backend, root: string): string | undefined {
  const database = databaseRefusal(String(record.database), root);
  if (database) return database;
  const port = portRefusal(Number(record.port), Number(record.mongoPort));
  if (port) return port;
  if (record.origin !== `http://127.0.0.1:${record.port}`) {
    return `Refusing origin ${record.origin}: the tool records only http://127.0.0.1:<port>.`;
  }
  if (record.pid !== undefined && (!Number.isInteger(record.pid) || record.pid <= 1)) {
    return `Refusing pid ${record.pid}.`;
  }
  return mongoPortRefusal(Number(record.mongoPort));
}

const refuse = (message: string) => Effect.fail(new Refused({ message }));

const readRecord = (root: string) =>
  Effect.try({
    try: () => readBackend(root),
    catch: () =>
      new Refused({
        message: `Cannot read ${statePath(root)}. Inspect it; nothing was stopped or dropped.`,
      }),
  });

const hasToken = (command: string, token: string) => ` ${command} `.includes(` ${token} `);

/** Whether the process, or one of its ancestors in the group, runs from this worktree's apps. */
function tracesToWorktree(member: GroupMember, members: readonly GroupMember[], root: string) {
  const byPid = new Map(members.map((each) => [each.pid, each]));
  const seen = new Set<number>();
  for (let current: GroupMember | undefined = member; current; current = byPid.get(current.ppid)) {
    // apps/ under the root, so a worktree nested inside this checkout doesn't count.
    if (current.command.includes(`${root}/apps/`)) return true;
    if (seen.has(current.pid)) return false;
    seen.add(current.pid);
  }
  return false;
}

/**
 * What is left of a recorded backend's process group:
 * - `ours`: its leader is this worktree's start.mjs, started when the record says;
 * - `orphaned`: the leader is gone (killed or out of memory), and every process left in
 *   the group traces back to this worktree, such as next-server under `next dev`;
 * - `foreign`: anything else, never signalled;
 * - `none`: no process is left.
 */
const groupState = (root: string, pid: number | undefined, processStart: string | undefined) =>
  Effect.gen(function* () {
    if (pid === undefined) return { kind: 'none' as const, members: [] };
    const processes = yield* Processes;
    const members = yield* processes.group(pid);
    if (members.length === 0) return { kind: 'none' as const, members };
    const leader = members.find((member) => member.pid === pid);
    if (leader) {
      const ours =
        hasToken(leader.command, backendScript(root, 'start.mjs')) &&
        processStart !== undefined &&
        (yield* processes.startTime(pid)) === processStart;
      return { kind: ours ? ('ours' as const) : ('foreign' as const), members };
    }
    const traced = members.every((member) => tracesToWorktree(member, members, root));
    return { kind: traced ? ('orphaned' as const) : ('foreign' as const), members };
  });

/** Stops a recorded backend's process group when it is this worktree's; never otherwise. */
const stopOwnGroup = (root: string, pid: number | undefined, processStart: string | undefined) =>
  Effect.gen(function* () {
    const state = yield* groupState(root, pid, processStart);
    if (pid !== undefined && (state.kind === 'ours' || state.kind === 'orphaned')) {
      yield* (yield* Processes).stopGroup(pid);
      return pid;
    }
    if (state.kind === 'foreign') {
      yield* (yield* Output).line(
        `Left process group ${pid} alone: its processes (${state.members
          .map((member) => member.pid)
          .join(', ')}) are not this worktree's backend.`,
      );
    }
    return undefined;
  });

const pickPort = (mongoPort: number) =>
  Effect.gen(function* () {
    const network = yield* Network;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const port = yield* network.freePort;
      if (!portRefusal(port, mongoPort)) return port;
    }
    return yield* Effect.fail(new ProcessFailed({ message: 'Found no free loopback port.' }));
  });

const seconds = (input: Duration.Input) => Math.round(Duration.toSeconds(input) * 10) / 10;

/**
 * Waits until the backend answers. Fails when its process group is no longer this
 * worktree's backend; gives up after the timeout.
 */
const waitForAnswer = (backend: Backend, root: string, timeout: Duration.Input) =>
  Effect.gen(function* () {
    const network = yield* Network;
    for (;;) {
      if (yield* network.answers(`${backend.origin}${readinessPath}`)) return 'answered' as const;
      const state = yield* groupState(root, backend.pid, backend.processStart);
      if (state.kind !== 'ours') return 'exited' as const;
      yield* Effect.sleep('250 millis');
    }
  }).pipe(
    Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.succeed('timeout' as const) }),
  );

interface Plan {
  readonly mongoPort: number;
  readonly database: string;
  readonly port: number | undefined;
  readonly server: ServerMode;
}

/** Checks the requested target before anything connects, starts or stops. */
function plan(options: UpOptions): Plan | string {
  const server = options.server ?? 'dev';
  if (!serverModes.includes(server)) {
    return `Refusing server ${server}: the backend runs as dev (next dev) or production (a production build).`;
  }
  const mongoPort = options.mongoPort ?? defaultMongoPort;
  const mongoRefusal = mongoPortRefusal(mongoPort);
  if (mongoRefusal) return mongoRefusal;
  const database =
    options.database ?? `${worktreePrefix(options.root)}${randomBytes(4).toString('hex')}`;
  const nameRefusal = databaseRefusal(database, options.root);
  if (nameRefusal) return nameRefusal;
  const target = { mongoPort, database, server: server as ServerMode };
  if (options.origin === undefined) return { ...target, port: undefined };
  const port = requestedPort(options.origin, mongoPort);
  return typeof port === 'string' ? port : { ...target, port };
}

/**
 * Drops a database `up` or the gate created and failed to finish starting. A failure is
 * reported and the record kept, so `pnpm swarm down` can finish the job.
 */
const dropAfterFailure = (root: string, backend: Backend) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const outcome = yield* (yield* Databases)
      .drop(backend.mongoPort, backend.database, worktreePrefix(root))
      .pipe(Effect.result);
    if (outcome._tag === 'Success') {
      if (outcome.success === 'dropped') yield* output.line(`Dropped ${backend.database}.`);
      return yield* forgetBackend(root);
    }
    if (outcome.failure._tag === 'Refused') {
      yield* output.line(`Left ${backend.database} in place. ${outcome.failure.message}`);
      return yield* forgetBackend(root);
    }
    yield* output.line(
      `Could not drop ${backend.database}: ${outcome.failure.message} The record ${statePath(root)} is kept; run pnpm swarm down to finish.`,
    );
  });

/**
 * Seeds a fresh database and starts a backend on it. Until the backend answers, a
 * failure, a timeout or an interruption stops its process group and drops the database.
 */
const launch = (options: UpOptions, target: Plan) =>
  Effect.gen(function* () {
    const { root } = options;
    const processes = yield* Processes;
    const databases = yield* Databases;
    const network = yield* Network;
    const output = yield* Output;
    const { mongoPort, database, server } = target;

    let port: number;
    if (target.port === undefined) {
      port = yield* pickPort(mongoPort);
    } else {
      if (!(yield* network.isPortFree(target.port))) {
        return yield* refuse(`Refusing port ${target.port}: it is in use.`);
      }
      port = target.port;
    }
    const origin = `http://127.0.0.1:${port}`;

    if ((yield* databases.list(mongoPort)).includes(database)) {
      return yield* refuse(
        `Refusing ${database}: it already exists, and up never adopts a database. pnpm swarm down drops this worktree's databases.`,
      );
    }

    const log = join(outDirectory(root), 'backend.log');
    yield* Effect.try({
      try: () => {
        mkdirSync(outDirectory(root), { recursive: true });
        writeFileSync(log, `# ${origin} on ${database}, Mongo port ${mongoPort}\n`);
      },
      catch: (error) => fileFailure(`write ${log}`, error),
    });
    const env = {
      PATH: process.env.PATH ?? '',
      SPLITBOOK_NATIVE_ORIGIN_PORT: String(port),
      SPLITBOOK_NATIVE_DATABASE: database,
      SPLITBOOK_NATIVE_MONGO_PORT: String(mongoPort),
    };
    const script = (name: 'seed.mjs' | 'start.mjs'): Launch => ({
      command: process.execPath,
      args: [backendScript(root, name)],
      cwd: root,
      // Only start.mjs serves the web app; the seed runs the same either way.
      env: name === 'start.mjs' ? { ...env, SPLITBOOK_NATIVE_SERVER: server } : env,
      log,
    });
    const started = Date.now();
    const seeding: Backend = {
      origin,
      port,
      database,
      mongoPort,
      log,
      startedAt: new Date(started).toISOString(),
      pid: undefined,
      processStart: undefined,
      readySeconds: undefined,
      server,
    };
    // Recorded before anything is created, so `down` knows the database and its Mongo port
    // even if this process dies.
    yield* writeBackend(root, seeding);

    return yield* Effect.scoped(
      Effect.gen(function* () {
        // Anything but success drops the database, after the backend is stopped.
        yield* Effect.acquireRelease(Effect.void, (_, exit) =>
          Exit.isSuccess(exit) ? Effect.void : dropAfterFailure(root, seeding),
        );

        yield* output.line(`Seeding ${database} on the Mongo server at 127.0.0.1:${mongoPort}`);
        const seedTimeout = options.seedTimeout ?? defaultSeedTimeout;
        const seeded = yield* processes.run(script('seed.mjs')).pipe(
          Effect.timeoutOrElse({
            duration: seedTimeout,
            orElse: () =>
              Effect.fail(
                new ProcessFailed({
                  message: withLog(
                    `The seed did not finish within ${seconds(seedTimeout)} s, so it was stopped.`,
                    log,
                  ),
                }),
              ),
          }),
        );
        if (seeded.exitCode !== 0) {
          return yield* Effect.fail(
            new ProcessFailed({
              message: withLog(`The seed failed (exit code ${seeded.exitCode}).`, log),
            }),
          );
        }

        yield* output.line(
          server === 'production'
            ? `Building the web app for production, then starting the backend at ${origin}`
            : `Starting the backend at ${origin}`,
        );
        const startedBackend = Date.now();
        const child = yield* Effect.acquireRelease(
          processes
            .start(script('start.mjs'))
            .pipe(
              Effect.flatMap(({ pid }) =>
                Effect.map(processes.startTime(pid), (processStart) => ({ pid, processStart })),
              ),
            ),
          ({ pid, processStart }, exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : Effect.gen(function* () {
                  if ((yield* stopOwnGroup(root, pid, processStart)) !== undefined) {
                    yield* output.line(`Stopped the backend at ${origin}.`);
                  }
                }),
        );
        const starting: Backend = { ...seeding, pid: child.pid, processStart: child.processStart };
        yield* writeBackend(root, starting);

        const readyTimeout = options.readyTimeout ?? defaultReadyTimeout;
        const outcome = yield* waitForAnswer(starting, root, readyTimeout);
        if (outcome === 'exited') {
          return yield* Effect.fail(
            new ProcessFailed({ message: withLog('The backend exited before it was ready.', log) }),
          );
        }
        if (outcome === 'timeout') {
          return yield* Effect.fail(
            new ProcessFailed({
              message: withLog(
                `The backend at ${origin} was not ready after ${seconds(readyTimeout)} s.`,
                log,
              ),
            }),
          );
        }
        const ready: Backend = {
          ...starting,
          readySeconds: Math.round((Date.now() - startedBackend) / 100) / 10,
        };
        yield* writeBackend(root, ready);
        return ready;
      }),
    );
  });

const announce = (backend: Backend, reused: boolean) =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.line(
      reused
        ? `This worktree's backend is already up at ${backend.origin}.`
        : `The backend is ready at ${backend.origin} after ${backend.readySeconds} s${backend.server === 'production' ? ', production build included' : ''}.`,
    );
    yield* output.line(`Log ${backend.log}`);
    yield* output.line(
      'Point the verifiers and the backend controls (control.mjs) at it with these variables:',
    );
    for (const [name, value] of Object.entries(backendVariables(backend))) {
      yield* output.line(`${name}=${value}`);
    }
  });

/**
 * This worktree's recorded backend when it is up. A backend that is running but not
 * answering (still compiling, or busy) is waited for, then refused, and never torn down.
 * A record whose backend is gone is cleaned up, as `down` would.
 */
const reuseOrClean = (options: UpOptions) =>
  Effect.gen(function* () {
    const { root } = options;
    const record = yield* readRecord(root);
    if (!record) return undefined;
    const refusal = recordRefusal(record, root);
    if (refusal) {
      return yield* refuse(
        `${refusal} The record is ${statePath(root)}; nothing was stopped or dropped.`,
      );
    }
    const state = yield* groupState(root, record.pid, record.processStart);
    if (state.kind === 'ours') {
      if (yield* (yield* Network).answers(`${record.origin}${readinessPath}`)) return record;
      const timeout = options.readyTimeout ?? defaultReadyTimeout;
      yield* (yield* Output).line(
        `This worktree's backend at ${record.origin} is running but not answering yet; waiting up to ${seconds(timeout)} s.`,
      );
      const outcome = yield* waitForAnswer(record, root, timeout);
      if (outcome === 'answered') return record;
      if (outcome === 'timeout') {
        return yield* refuse(
          `This worktree's backend (pid ${record.pid}) is running but has not answered at ${record.origin}. It was left running. See ${record.log}; pnpm swarm down stops it.`,
        );
      }
    }
    // The leader is gone, or the pid is now another process: clean up after it first.
    yield* downUnlocked({ root, mongoPort: options.mongoPort });
    return undefined;
  });

/**
 * Starts this worktree's backend, or reuses it when it is already up. Prints the
 * MOBILE_VERIFY_URL and SPLITBOOK_NATIVE_* variables to use. The backend keeps running
 * after `up` returns.
 */
export const up = (
  options: UpOptions,
): Effect.Effect<
  { readonly backend: Backend; readonly reused: boolean },
  SwarmError,
  Processes | Databases | Network | Output
> =>
  Effect.gen(function* () {
    const target = plan(options);
    if (typeof target === 'string') return yield* refuse(target);
    return yield* withWorktreeLock(
      options.root,
      'up',
      Effect.gen(function* () {
        const existing = yield* reuseOrClean(options);
        if (existing) {
          const existingServer = existing.server ?? 'dev';
          if (
            (options.origin !== undefined && options.origin !== existing.origin) ||
            (options.database !== undefined && options.database !== existing.database) ||
            (options.server !== undefined && options.server !== existingServer)
          ) {
            return yield* refuse(
              `This worktree's backend is already up at ${existing.origin} on ${existing.database} (${existingServer}). Run pnpm swarm down first.`,
            );
          }
          yield* announce(existing, true);
          return { backend: existing, reused: true };
        }
        const backend = yield* launch(options, target);
        yield* announce(backend, false);
        return { backend, reused: false };
      }),
    );
  });

/**
 * This worktree's backend for the length of a scope: the one `up` started, or a new one
 * that is stopped, with its database dropped, when the scope closes. The caller holds the
 * worktree lock.
 */
export const backendForScope = (
  options: UpOptions,
): Effect.Effect<
  { readonly backend: Backend; readonly startedHere: boolean },
  SwarmError,
  Processes | Databases | Network | Output | Scope.Scope
> =>
  Effect.gen(function* () {
    const target = plan(options);
    if (typeof target === 'string') return yield* refuse(target);
    const existing = yield* reuseOrClean(options);
    if (existing) return { backend: existing, startedHere: false };
    const output = yield* Output;
    const backend = yield* Effect.acquireRelease(
      launch(options, target),
      (started) =>
        downUnlocked({ root: options.root, mongoPort: started.mongoPort }).pipe(
          Effect.catch((error) => output.line(`Could not take the backend down: ${error.message}`)),
        ),
      // Starting can take minutes; an interruption must reach it. launch cleans up after itself.
      { interruptible: true },
    );
    return { backend, startedHere: true };
  });

const downUnlocked = (
  options: DownOptions,
): Effect.Effect<DownResult, SwarmError, Processes | Databases | Output> =>
  Effect.gen(function* () {
    const { root } = options;
    const databases = yield* Databases;
    const output = yield* Output;

    const record = yield* readRecord(root);
    if (record) {
      const refusal = recordRefusal(record, root);
      if (refusal) {
        return yield* refuse(
          `${refusal} The record is ${statePath(root)}; nothing was stopped or dropped.`,
        );
      }
    }
    const mongoPort = options.mongoPort ?? record?.mongoPort ?? defaultMongoPort;
    const mongoRefusal = mongoPortRefusal(mongoPort);
    if (mongoRefusal) return yield* refuse(mongoRefusal);

    // Stopping comes first, so a live backend can't write to a database being dropped.
    const stopped = record ? yield* stopOwnGroup(root, record.pid, record.processStart) : undefined;
    if (record && stopped !== undefined)
      yield* output.line(`Stopped the backend at ${record.origin}.`);

    const prefix = worktreePrefix(root);
    const own = (yield* databases.list(mongoPort)).filter((name) => name.startsWith(prefix));
    const dropped: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];
    for (const name of own) {
      const outcome = yield* databases.drop(mongoPort, name, prefix).pipe(Effect.result);
      if (outcome._tag === 'Success') {
        dropped.push(name);
        yield* output.line(`Dropped ${name}.`);
      } else if (outcome.failure._tag === 'Refused') {
        skipped.push(name);
        yield* output.line(`Warning: left ${name} in place. ${outcome.failure.message}`);
      } else {
        failed.push(`${name}: ${outcome.failure.message}`);
      }
    }
    if (failed.length) {
      return yield* Effect.fail(
        new MongoFailed({
          message: `Could not drop ${failed.join('; ')}. The record ${statePath(root)} is kept, so pnpm swarm down can run again.`,
        }),
      );
    }
    yield* forgetBackend(root);
    if (stopped === undefined && own.length === 0) {
      yield* output.line('This worktree has no backend and no databases.');
    }
    return { stopped, dropped, skipped };
  });

/**
 * Stops this worktree's backend and drops this worktree's databases, and nothing else.
 * A database without the ownership marker is left in place with a warning. The record is
 * kept when a drop fails, so `down` can run again.
 */
export const down = (
  options: DownOptions,
): Effect.Effect<DownResult, SwarmError, Processes | Databases | Output> =>
  withWorktreeLock(options.root, 'down', downUnlocked(options));
