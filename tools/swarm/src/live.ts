/**
 * The real machine behind the services: Node child processes in their own process
 * groups, the MongoDB driver on loopback only, and loopback sockets.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { Effect, Layer } from 'effect';
import { MongoClient } from 'mongodb';
import { toolPrefix } from './backend.ts';
import {
  Databases,
  MongoFailed,
  Network,
  Output,
  Processes,
  ProcessFailed,
  Refused,
  type Launch,
} from './platform.ts';

/**
 * The fictional backend's ownership marker (apps/mobile/scripts/dev-backend/environment.mjs).
 * Its seed writes it first; a test keeps the two in step.
 */
export const fictionalMarker = 'splitbook-native-ticket-50-fictional-only';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether any process is left in the group. */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

async function waitForGroup(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (groupAlive(pid)) {
    if (Date.now() > deadline) return false;
    await sleep(100);
  }
  return true;
}

/** SIGTERM to the whole group, then SIGKILL after a grace period. */
async function stopGroup(pid: number, graceMs = 10_000): Promise<void> {
  if (pid <= 1) return;
  signalGroup(pid, 'SIGTERM');
  if (await waitForGroup(pid, graceMs)) return;
  signalGroup(pid, 'SIGKILL');
  await waitForGroup(pid, 5_000);
}

/** Spawns a process group leader whose stdout and stderr go to the launch's log. */
function spawnInGroup(launch: Launch): ChildProcess {
  const fd = openSync(launch.log, 'a');
  try {
    return spawn(launch.command, [...launch.args], {
      cwd: launch.cwd,
      env: { ...launch.env },
      detached: true,
      stdio: ['ignore', fd, fd],
    });
  } finally {
    closeSync(fd);
  }
}

const failedToStart = (launch: Launch, error: unknown) =>
  new ProcessFailed({
    message: `Could not start ${launch.command}: ${error instanceof Error ? error.message : String(error)}`,
  });

export const ProcessesLive = Layer.succeed(Processes, {
  start: (launch) =>
    Effect.try({
      try: () => {
        const child = spawnInGroup(launch);
        if (child.pid === undefined) throw new Error('it did not get a process id');
        child.on('error', () => undefined);
        // The backend outlives this process: don't keep the event loop open for it.
        child.unref();
        return { pid: child.pid };
      },
      catch: (error) => failedToStart(launch, error),
    }),

  run: (launch) =>
    Effect.callback((resume) => {
      let child: ChildProcess;
      try {
        child = spawnInGroup(launch);
      } catch (error) {
        resume(Effect.fail(failedToStart(launch, error)));
        return;
      }
      const pid = child.pid;
      child.once('error', (error) => resume(Effect.fail(failedToStart(launch, error))));
      child.once('exit', (exitCode) => {
        // Anything the step left running in its group goes with it.
        if (pid !== undefined && groupAlive(pid)) void stopGroup(pid, 2_000);
        resume(Effect.succeed({ exitCode }));
      });
      // Interrupted (a timeout, Ctrl-C): stop the whole group before going on.
      return Effect.promise(() => (pid === undefined ? Promise.resolve() : stopGroup(pid)));
    }),

  output: (command, args, cwd) =>
    Effect.callback<string | undefined>((resume) => {
      execFile(command, [...args], { cwd, timeout: 10_000 }, (error, stdout) =>
        resume(Effect.succeed(error ? undefined : stdout.trim() || undefined)),
      );
    }),

  commandLine: (pid) =>
    Effect.callback<string | undefined>((resume) => {
      if (!Number.isInteger(pid) || pid <= 1) return resume(Effect.succeed(undefined));
      execFile('ps', ['-o', 'command=', '-p', String(pid)], (error, stdout) =>
        resume(Effect.succeed(error ? undefined : stdout.trim() || undefined)),
      );
    }),

  stopGroup: (pid) => Effect.promise(() => stopGroup(pid)),
});

/** One short-lived client per operation, always on loopback, never with credentials. */
const withMongo = <A>(mongoPort: number, action: (client: MongoClient) => Promise<A>) =>
  Effect.tryPromise({
    try: async () => {
      const client = new MongoClient(`mongodb://127.0.0.1:${mongoPort}/?directConnection=true`, {
        serverSelectionTimeoutMS: 5_000,
      });
      try {
        await client.connect();
        return await action(client);
      } finally {
        await client.close();
      }
    },
    catch: (error) =>
      new MongoFailed({
        message: `The Mongo server at 127.0.0.1:${mongoPort} failed: ${error instanceof Error ? error.message : String(error)}. Is it running? Set --mongo-port or SPLITBOOK_NATIVE_MONGO_PORT if it uses another port.`,
      }),
  });

export const DatabasesLive = Layer.succeed(Databases, {
  list: (mongoPort) =>
    withMongo(mongoPort, async (client) => {
      const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true });
      return databases.map((database) => database.name);
    }),
  isFictional: (mongoPort, name) =>
    withMongo(mongoPort, async (client) => {
      const marker = await client
        .db(name)
        .collection<{ _id: string; fictional?: unknown }>('native_verification')
        .findOne({ _id: fictionalMarker });
      return marker?.fictional === true;
    }),
  drop: (mongoPort, name) =>
    // A last guard under the commands' own checks: only the tool's databases are dropped.
    name.startsWith(toolPrefix) && /^[a-z0-9_]+$/.test(name)
      ? withMongo(mongoPort, async (client) => {
          await client.db(name).dropDatabase();
        })
      : Effect.fail(new Refused({ message: `Refusing to drop ${name}: it is not the tool's.` })),
});

const listen = (port: number) =>
  new Promise<number | undefined>((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(undefined));
    server.listen(port, '127.0.0.1', () => {
      const { port: bound } = server.address() as AddressInfo;
      server.close(() => resolve(bound));
    });
  });

export const NetworkLive = Layer.succeed(Network, {
  freePort: Effect.promise(async () => {
    const port = await listen(0);
    if (port === undefined) throw new Error('The operating system gave no free port.');
    return port;
  }),
  isPortFree: (port) => Effect.promise(async () => (await listen(port)) !== undefined),
  answers: (url) =>
    Effect.tryPromise(async (signal) => {
      // The first request compiles the route in `next dev`, which can take a while.
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      });
      await response.body?.cancel();
      return response.status < 500;
    }).pipe(Effect.orElseSucceed(() => false)),
});

export const OutputLive = Layer.succeed(Output, {
  line: (text) => Effect.sync(() => void process.stdout.write(`${text}\n`)),
});

export const LiveLayer = Layer.mergeAll(ProcessesLive, DatabasesLive, NetworkLive, OutputLive);
