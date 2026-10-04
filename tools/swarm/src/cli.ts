/**
 * `pnpm swarm up | down | gate`: flags, the live services, and a runner that turns Ctrl-C
 * or a termination signal into an interruption, so every finalizer runs: the backend a
 * command started is stopped and its database dropped before the process exits.
 */
import { parseArgs } from 'node:util';
import { Cause, Effect, Exit, Option, Runtime } from 'effect';
import { down, up } from './backend.ts';
import { checkInstall } from './install.ts';
import { defaultVitestWorkers, gate } from './gate.ts';
import { LiveLayer } from './live.ts';
import {
  Refused,
  type Databases,
  type Network,
  type Output,
  type Processes,
  type SwarmError,
} from './platform.ts';

const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/** Like a platform runMain, but quiet: the commands print their own messages. */
const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  let interrupted = false;
  const onSignal = (signal: NodeJS.Signals) => {
    // pnpm and the terminal can both deliver the same Ctrl-C; one interruption is enough.
    if (interrupted) return;
    interrupted = true;
    process.stderr.write(`\n${signal}: stopping what this command started.\n`);
    fiber.interruptUnsafe();
  };
  for (const signal of signals) process.on(signal, onSignal);
  fiber.addObserver((exit) => {
    for (const signal of signals) process.off(signal, onSignal);
    teardown(exit, (code) => {
      process.exitCode = code;
    });
  });
});

/** The exit code a command's success value carries, and messages for failures. */
const teardown: Runtime.Teardown = (exit, onExit) => {
  if (Exit.isSuccess(exit)) return onExit(typeof exit.value === 'number' ? exit.value : 0);
  if (Cause.hasInterruptsOnly(exit.cause)) {
    process.stderr.write('Interrupted. Everything this command started was stopped.\n');
    return onExit(130);
  }
  const error = Cause.findErrorOption(exit.cause);
  process.stderr.write(
    Option.isSome(error) && error.value instanceof Error
      ? `${error.value.message}\n`
      : `${Cause.pretty(exit.cause)}\n`,
  );
  onExit(1);
};

const number = (name: string, value: string | undefined) => {
  if (value === undefined) return Effect.succeed(undefined);
  return /^\d+$/.test(value)
    ? Effect.succeed(Number(value))
    : Effect.fail(new Refused({ message: `${name} must be a whole number, not ${value}.` }));
};

const secondsInput = (name: string, value: string | undefined) =>
  Effect.map(number(name, value), (seconds) =>
    seconds === undefined ? undefined : (`${seconds} seconds` as const),
  );

const program = (
  command: string,
  args: readonly string[],
  root: string,
): Effect.Effect<number, SwarmError, Processes | Databases | Network | Output> =>
  Effect.gen(function* () {
    const { values } = yield* Effect.try({
      try: () =>
        parseArgs({
          args: [...args],
          options: {
            origin: { type: 'string' },
            database: { type: 'string' },
            'mongo-port': { type: 'string' },
            'ready-timeout': { type: 'string' },
            base: { type: 'string' },
            'vitest-workers': { type: 'string' },
            'step-timeout': { type: 'string' },
          },
          strict: true,
        }),
      catch: (error) => new Refused({ message: (error as Error).message }),
    });
    const env = process.env;
    const mongoPort = yield* number(
      '--mongo-port',
      values['mongo-port'] ?? env.SPLITBOOK_NATIVE_MONGO_PORT,
    );
    const readyTimeout = yield* secondsInput('--ready-timeout', values['ready-timeout']);

    if (command === 'up') {
      const install = checkInstall(root);
      if (!install.ok) return yield* Effect.fail(new Refused({ message: install.message }));
      // #185's variables, when set, are requests like the flags: checked, never trusted.
      const originPort = env.SPLITBOOK_NATIVE_ORIGIN_PORT;
      yield* up({
        root,
        origin: values.origin ?? (originPort ? `http://127.0.0.1:${originPort}` : undefined),
        database: values.database ?? env.SPLITBOOK_NATIVE_DATABASE,
        mongoPort,
        readyTimeout,
      });
      return 0;
    }
    if (command === 'down') {
      yield* down({ root, mongoPort });
      return 0;
    }
    const vitestWorkers =
      (yield* number('--vitest-workers', values['vitest-workers'] ?? env.SWARM_VITEST_WORKERS)) ??
      defaultVitestWorkers;
    if (vitestWorkers < 1) {
      return yield* Effect.fail(new Refused({ message: '--vitest-workers must be at least 1.' }));
    }
    const verdict = yield* gate({
      root,
      base: values.base,
      vitestWorkers,
      stepTimeout: yield* secondsInput('--step-timeout', values['step-timeout']),
      mongoPort,
      readyTimeout,
    });
    return verdict.verdict === 'pass' ? 0 : 1;
  });

export function run(command: 'up' | 'down' | 'gate', args: readonly string[], root: string) {
  runMain(program(command, args, root).pipe(Effect.provide(LiveLayer)), {
    disableErrorReporting: true,
    teardown,
  });
}
