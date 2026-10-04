/**
 * A fictional backend per worktree: `up` picks a free loopback port and a fresh
 * database with the tool's own prefix, seeds it, starts the backend through #185's
 * variables and waits until it answers. `down` stops it and drops only this worktree's
 * databases.
 *
 * Safety rules, enforced before anything connects or starts:
 * - the origin is http://127.0.0.1:<port>, never port 4138 (the shared backend's);
 * - every database name starts with this worktree's prefix inside splitbook_mobile_swarm_,
 *   so it is never splitbook_mobile_50, a demo database or another worktree's;
 * - `up` never adopts a database that already exists;
 * - `down` stops a process only when it is this worktree's own start.mjs, and drops only
 *   databases with this worktree's prefix that hold the fictional ownership marker.
 *
 * The backend's own scripts keep refusing .env files and build the server's environment
 * themselves; this module passes them only PATH and the three SPLITBOOK_NATIVE_* variables.
 */
import { createHash, randomBytes } from 'node:crypto';
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
import {
  Databases,
  Network,
  Output,
  Processes,
  ProcessFailed,
  Refused,
  type Launch,
  type SwarmError,
} from './platform.ts';

/** Every database the tool creates starts with this, inside #185's splitbook_mobile_ rule. */
export const toolPrefix = 'splitbook_mobile_swarm_';
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
const defaultSeedTimeout: Duration.Input = '2 minutes';

export interface Backend {
  readonly origin: string;
  readonly port: number;
  readonly database: string;
  readonly mongoPort: number;
  /** The process group leader: the backend's start.mjs. */
  readonly pid: number;
  readonly log: string;
  readonly startedAt: string;
  /** Seconds from start to the first answer; undefined while it starts. */
  readonly readySeconds: number | undefined;
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
}

export interface DownOptions {
  readonly root: string;
  /** Default: the recorded backend's Mongo port, else 27018. */
  readonly mongoPort?: number | undefined;
}

/** This worktree's databases start with this: the tool prefix and a hash of the worktree path. */
export function worktreePrefix(root: string): string {
  return `${toolPrefix}${createHash('sha256').update(root).digest('hex').slice(0, 10)}_`;
}

export const outDirectory = (root: string) => join(root, 'tools/swarm/out');
export const statePath = (root: string) => join(outDirectory(root), 'backend.json');
const backendScript = (root: string, name: 'seed.mjs' | 'start.mjs') =>
  join(root, 'apps/mobile/scripts/dev-backend', name);

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

function writeBackend(root: string, backend: Backend) {
  mkdirSync(dirname(statePath(root)), { recursive: true });
  writeFileSync(statePath(root), `${JSON.stringify(backend, null, 2)}\n`);
}

const forgetBackend = (root: string) => rmSync(statePath(root), { force: true });

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
  if (!Number.isInteger(record.pid) || record.pid <= 1) return `Refusing pid ${record.pid}.`;
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

/** Whether the process is this worktree's own backend: its start.mjs, by absolute path. */
const isOwnBackend = (pid: number, root: string) =>
  Effect.gen(function* () {
    const line = yield* (yield* Processes).commandLine(pid);
    return line !== undefined && ` ${line} `.includes(` ${backendScript(root, 'start.mjs')} `);
  });

/** The recorded backend, when it is this worktree's own, still running, and answering. */
const runningBackend = (root: string) =>
  Effect.gen(function* () {
    const record = yield* readRecord(root);
    if (!record || recordRefusal(record, root)) return undefined;
    if (!(yield* isOwnBackend(record.pid, root))) return undefined;
    const answers = yield* (yield* Network).answers(`${record.origin}${readinessPath}`);
    return answers ? record : undefined;
  });

const pickPort = (mongoPort: number) =>
  Effect.gen(function* () {
    const network = yield* Network;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const port = yield* network.freePort;
      if (!portRefusal(port, mongoPort)) return port;
    }
    return yield* Effect.fail(new ProcessFailed({ message: 'Found no free loopback port.' }));
  });

const seconds = (input: Duration.Input) => Math.round(Duration.toSeconds(input) * 10) / 10;

const waitUntilReady = (backend: Backend, root: string, timeout: Duration.Input) =>
  Effect.gen(function* () {
    const network = yield* Network;
    for (;;) {
      if (yield* network.answers(`${backend.origin}${readinessPath}`)) return;
      if (!(yield* isOwnBackend(backend.pid, root))) {
        return yield* Effect.fail(
          new ProcessFailed({
            message: withLog(
              'The backend exited before it was ready, so its database was dropped.',
              backend.log,
            ),
          }),
        );
      }
      yield* Effect.sleep('250 millis');
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(
          new ProcessFailed({
            message: withLog(
              `The backend at ${backend.origin} was not ready after ${seconds(timeout)} s, so it was stopped and its database dropped.`,
              backend.log,
            ),
          }),
        ),
    }),
  );

/**
 * Seeds a fresh database and starts a backend on it. Until the backend answers, a
 * failure, a timeout or an interruption stops the process group and drops the database.
 */
const launch = (options: UpOptions) =>
  Effect.gen(function* () {
    const { root } = options;
    const processes = yield* Processes;
    const databases = yield* Databases;
    const network = yield* Network;
    const output = yield* Output;

    const mongoPort = options.mongoPort ?? defaultMongoPort;
    const mongoRefusal = mongoPortRefusal(mongoPort);
    if (mongoRefusal) return yield* refuse(mongoRefusal);
    const database = options.database ?? `${worktreePrefix(root)}${randomBytes(4).toString('hex')}`;
    const nameRefusal = databaseRefusal(database, root);
    if (nameRefusal) return yield* refuse(nameRefusal);
    let port: number;
    if (options.origin === undefined) {
      port = yield* pickPort(mongoPort);
    } else {
      const requested = requestedPort(options.origin, mongoPort);
      if (typeof requested === 'string') return yield* refuse(requested);
      if (!(yield* network.isPortFree(requested))) {
        return yield* refuse(`Refusing port ${requested}: it is in use.`);
      }
      port = requested;
    }
    const origin = `http://127.0.0.1:${port}`;

    if ((yield* databases.list(mongoPort)).includes(database)) {
      return yield* refuse(
        `Refusing ${database}: it already exists, and up never adopts a database. pnpm swarm down drops this worktree's databases.`,
      );
    }

    mkdirSync(outDirectory(root), { recursive: true });
    const log = join(outDirectory(root), 'backend.log');
    writeFileSync(log, `# ${origin} on ${database}, Mongo port ${mongoPort}\n`);
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
      env,
      log,
    });

    return yield* Effect.scoped(
      Effect.gen(function* () {
        // From here on, anything but success drops the database and the record.
        yield* Effect.acquireRelease(Effect.void, (_, exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : databases.drop(mongoPort, database).pipe(
                Effect.catch(() => Effect.void),
                Effect.andThen(Effect.sync(() => forgetBackend(root))),
              ),
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
              message: withLog(
                `The seed failed (exit code ${seeded.exitCode}), so its database was dropped.`,
                log,
              ),
            }),
          );
        }

        yield* output.line(`Starting the backend at ${origin}`);
        const startedAt = Date.now();
        const { pid } = yield* Effect.acquireRelease(
          processes.start(script('start.mjs')),
          (child, exit) => (Exit.isSuccess(exit) ? Effect.void : processes.stopGroup(child.pid)),
        );
        const starting: Backend = {
          origin,
          port,
          database,
          mongoPort,
          pid,
          log,
          startedAt: new Date(startedAt).toISOString(),
          readySeconds: undefined,
        };
        // Recorded at once, so `down` finds it even if this process dies.
        writeBackend(root, starting);
        yield* waitUntilReady(starting, root, options.readyTimeout ?? defaultReadyTimeout);
        const ready = {
          ...starting,
          readySeconds: Math.round((Date.now() - startedAt) / 100) / 10,
        };
        writeBackend(root, ready);
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
        : `The backend is ready at ${backend.origin} after ${backend.readySeconds} s.`,
    );
    yield* output.line(
      `Database ${backend.database}, Mongo port ${backend.mongoPort}, log ${backend.log}`,
    );
    yield* output.line(`MOBILE_VERIFY_URL=${backend.origin}`);
  });

/**
 * Starts this worktree's backend, or reuses it when it is already up. Prints the
 * MOBILE_VERIFY_URL to use. The backend keeps running after `up` returns.
 */
export const up = (
  options: UpOptions,
): Effect.Effect<
  { readonly backend: Backend; readonly reused: boolean },
  SwarmError,
  Processes | Databases | Network | Output
> =>
  Effect.gen(function* () {
    const existing = yield* runningBackend(options.root);
    if (existing) {
      if (
        (options.origin !== undefined && options.origin !== existing.origin) ||
        (options.database !== undefined && options.database !== existing.database)
      ) {
        return yield* refuse(
          `This worktree's backend is already up at ${existing.origin} on ${existing.database}. Run pnpm swarm down first.`,
        );
      }
      yield* announce(existing, true);
      return { backend: existing, reused: true };
    }
    // A record without a running backend: a crash or a reboot. Clean up after it first.
    if (yield* readRecord(options.root)) {
      yield* down({ root: options.root, mongoPort: options.mongoPort });
    }
    const backend = yield* launch(options);
    yield* announce(backend, false);
    return { backend, reused: false };
  });

/**
 * This worktree's backend for the length of a scope: the one `up` started, or a new one
 * that is stopped, with its database dropped, when the scope closes.
 */
export const backendForScope = (
  options: UpOptions,
): Effect.Effect<
  { readonly backend: Backend; readonly startedHere: boolean },
  SwarmError,
  Processes | Databases | Network | Output | Scope.Scope
> =>
  Effect.gen(function* () {
    const existing = yield* runningBackend(options.root);
    if (existing) return { backend: existing, startedHere: false };
    if (yield* readRecord(options.root)) {
      yield* down({ root: options.root, mongoPort: options.mongoPort });
    }
    const output = yield* Output;
    const backend = yield* Effect.acquireRelease(
      launch(options),
      (started) =>
        down({ root: options.root, mongoPort: started.mongoPort }).pipe(
          Effect.catch((error) => output.line(`Could not take the backend down: ${error.message}`)),
        ),
      // Starting can take minutes; an interruption must reach it. launch cleans up after itself.
      { interruptible: true },
    );
    return { backend, startedHere: true };
  });

/**
 * Stops this worktree's backend and drops this worktree's databases, and nothing else.
 * The record is checked before anything is stopped, and every database before any is
 * dropped. The record is kept until the databases are gone, so `down` can run again.
 */
export const down = (
  options: DownOptions,
): Effect.Effect<
  { readonly stopped: number | undefined; readonly dropped: readonly string[] },
  SwarmError,
  Processes | Databases | Output
> =>
  Effect.gen(function* () {
    const { root } = options;
    const processes = yield* Processes;
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

    // Stopping comes first: the process is this worktree's own start.mjs, so stopping it
    // is always safe, even when Mongo is down and nothing can be dropped yet.
    let stopped: number | undefined;
    if (record && (yield* isOwnBackend(record.pid, root))) {
      yield* processes.stopGroup(record.pid);
      stopped = record.pid;
      yield* output.line(`Stopped the backend at ${record.origin}.`);
    }

    const own = (yield* databases.list(mongoPort)).filter((name) =>
      name.startsWith(worktreePrefix(root)),
    );
    for (const name of own) {
      const refusal = databaseRefusal(name, root);
      if (refusal) return yield* refuse(`${refusal} Nothing was dropped.`);
      if (!(yield* databases.isFictional(mongoPort, name))) {
        return yield* refuse(
          `Refusing to drop ${name}: it has no fictional ownership marker, so the tool did not create it. Nothing was dropped.`,
        );
      }
    }
    for (const name of own) {
      yield* databases.drop(mongoPort, name);
      yield* output.line(`Dropped ${name}.`);
    }
    forgetBackend(root);
    if (stopped === undefined && own.length === 0) {
      yield* output.line('This worktree has no backend and no databases.');
    }
    return { stopped, dropped: own };
  });
