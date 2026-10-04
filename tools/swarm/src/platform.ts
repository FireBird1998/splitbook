/**
 * What the commands need from the machine: processes, the local Mongo server and the
 * network. Each is a service, so tests give the commands fakes and the CLI gives them
 * the real thing (`live.ts`).
 */
import { Context, Data, type Effect } from 'effect';

/** A safety rule refused the request. Nothing was changed. */
export class Refused extends Data.TaggedError('Refused')<{ readonly message: string }> {}

/** The local Mongo server could not be reached or refused an operation. */
export class MongoFailed extends Data.TaggedError('MongoFailed')<{ readonly message: string }> {}

/** A process could not start, or the backend failed before it was ready. */
export class ProcessFailed extends Data.TaggedError('ProcessFailed')<{
  readonly message: string;
}> {}

export type SwarmError = Refused | MongoFailed | ProcessFailed;

export interface Launch {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** The whole environment of the process: nothing is inherited that isn't listed. */
  readonly env: Readonly<Record<string, string>>;
  /** stdout and stderr are appended to this file. */
  readonly log: string;
}

export interface Finished {
  /** null when a signal ended the process. */
  readonly exitCode: number | null;
}

export class Processes extends Context.Service<
  Processes,
  {
    /**
     * Starts a long-running process as the leader of its own process group, detached,
     * so it outlives this one. `stopGroup` stops it and everything it started.
     */
    readonly start: (launch: Launch) => Effect.Effect<{ readonly pid: number }, ProcessFailed>;
    /**
     * Runs a process in its own process group until it exits. Interrupting the effect
     * stops the whole group, so a timed-out or cancelled step leaves nothing behind.
     */
    readonly run: (launch: Launch) => Effect.Effect<Finished, ProcessFailed>;
    /** The trimmed stdout of a short command, or undefined when it fails. */
    readonly output: (
      command: string,
      args: readonly string[],
      cwd: string,
    ) => Effect.Effect<string | undefined>;
    /** The command line of a running process, or undefined when there is none. */
    readonly commandLine: (pid: number) => Effect.Effect<string | undefined>;
    /** Stops a process group: SIGTERM, then SIGKILL if it is still there after a grace period. */
    readonly stopGroup: (pid: number) => Effect.Effect<void>;
  }
>()('swarm/Processes') {}

export class Databases extends Context.Service<
  Databases,
  {
    /** The names of every database on the loopback Mongo server at this port. */
    readonly list: (mongoPort: number) => Effect.Effect<readonly string[], MongoFailed>;
    /** Whether the database holds the fictional backend's ownership marker. */
    readonly isFictional: (mongoPort: number, name: string) => Effect.Effect<boolean, MongoFailed>;
    readonly drop: (mongoPort: number, name: string) => Effect.Effect<void, MongoFailed | Refused>;
  }
>()('swarm/Databases') {}

export class Network extends Context.Service<
  Network,
  {
    /** A loopback TCP port the operating system reports free. */
    readonly freePort: Effect.Effect<number>;
    readonly isPortFree: (port: number) => Effect.Effect<boolean>;
    /** Whether the URL answers with a status below 500. */
    readonly answers: (url: string) => Effect.Effect<boolean>;
  }
>()('swarm/Network') {}

/** Where progress lines go: the terminal in the CLI, nowhere in tests. */
export class Output extends Context.Service<
  Output,
  { readonly line: (text: string) => Effect.Effect<void> }
>()('swarm/Output') {}
