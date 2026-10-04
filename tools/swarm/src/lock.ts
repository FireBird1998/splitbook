/**
 * One swarm command at a time per worktree. `up`, `down` and `gate` each hold
 * tools/swarm/out/swarm.lock while they run, so a gate can't take down a backend that an
 * `up` is still starting, and two `up`s can't both start one.
 *
 * The lock is created atomically with its content (a link to a complete file fails if the
 * lock exists). It names its holder by pid and start time, so a lock left by a command that
 * was killed is recognised as stale and replaced, even when the pid has been reused.
 */
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { Processes, ProcessFailed, Refused } from './platform.ts';

export const lockPath = (root: string) => join(root, 'tools/swarm/out/swarm.lock');

interface Holder {
  readonly pid: number;
  /** As `ps -o lstart` printed it when the holder took the lock. */
  readonly started: string | undefined;
  readonly command: string;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function parseHolder(text: string | undefined): Holder | undefined {
  try {
    const holder = JSON.parse(text ?? '') as Partial<Holder>;
    return Number.isInteger(holder.pid) && typeof holder.command === 'string'
      ? { pid: holder.pid as number, started: holder.started, command: holder.command }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Creates the lock with its content in one step; false when it already exists. */
function create(path: string, content: string): boolean {
  mkdirSync(dirname(path), { recursive: true });
  const draft = `${path}.${process.pid}.tmp`;
  writeFileSync(draft, content);
  try {
    linkSync(draft, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    rmSync(draft, { force: true });
  }
}

const acquire = (root: string, command: string) =>
  Effect.gen(function* () {
    const processes = yield* Processes;
    const path = lockPath(root);
    const mine: Holder = {
      pid: process.pid,
      started: yield* processes.startTime(process.pid),
      command,
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const created = yield* Effect.try({
        try: () => create(path, JSON.stringify(mine)),
        catch: (error) =>
          new ProcessFailed({ message: `Cannot create ${path}: ${(error as Error).message}` }),
      });
      if (created) return;
      const text = readText(path);
      const holder = parseHolder(text);
      if (holder) {
        const started = yield* processes.startTime(holder.pid);
        const alive =
          started !== undefined && (holder.started === undefined || started === holder.started);
        if (alive) {
          return yield* Effect.fail(
            new Refused({
              message: `Another pnpm swarm ${holder.command} (pid ${holder.pid}) is running in this worktree. One swarm command runs at a time per worktree: wait for it to finish.`,
            }),
          );
        }
      }
      // A lock left by a command that is gone. Remove it unless another command just replaced it.
      if (readText(path) === text) rmSync(path, { force: true });
    }
    return yield* Effect.fail(new ProcessFailed({ message: `Could not take ${path}.` }));
  });

const release = (root: string) =>
  Effect.sync(() => {
    const path = lockPath(root);
    if (parseHolder(readText(path))?.pid === process.pid) rmSync(path, { force: true });
  });

/** Runs the effect while holding this worktree's lock, released however the effect ends. */
export const withWorktreeLock = <A, E, R>(
  root: string,
  command: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Refused | ProcessFailed, R | Processes> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(acquire(root, command), () => release(root));
      return yield* effect;
    }),
  );
