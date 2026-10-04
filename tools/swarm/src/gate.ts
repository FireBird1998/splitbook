/**
 * The gate: every check a ticket needs, run in this worktree, with one verdict.
 *
 * 1. the install check, so a stale install never shows up as failing tests;
 * 2. lint, typecheck and the format check (the root scripts CI runs);
 * 3. unit tests, never the web integration tests, with vitest workers capped;
 * 4. the ceiling comparison with the base commit, through #206's script;
 * 5. every `verify:*` script, one after another, against this worktree's backend.
 *
 * A failing step does not stop the others, except the install check. Each step has a
 * timeout. A timeout, Ctrl-C or a signal stops the step's whole process group and the
 * backend the gate started.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Duration, Effect } from 'effect';
import { backendForScope, logTail, outDirectory } from './backend.ts';
import { checkInstall } from './install.ts';
import { Output, Processes, type Databases, type Network } from './platform.ts';
import {
  defaultVitestWorkers,
  renderVerdict,
  stepLine,
  writeVerdict,
  type StepResult,
  type Verdict,
} from './verdict.ts';

export { defaultVitestWorkers, verdictPath, type StepResult, type Verdict } from './verdict.ts';

/** The script #206 adds to apps/mobile/package.json; the gate calls it, never a copy. */
export const ceilingScript = 'ceilings:compare';
/** verify:financial's fixtures need this zone; the README runs every verifier in it. */
const verifierTimeZone = 'Asia/Kolkata';

const timeouts = {
  lint: '15 minutes',
  typecheck: '15 minutes',
  format: '5 minutes',
  unit: '20 minutes',
  ceilings: '5 minutes',
  verifier: '10 minutes',
} satisfies Record<string, Duration.Input>;

export interface GateOptions {
  readonly root: string;
  /** The ref whose merge-base with HEAD is the base commit. Default origin/main, else main. */
  readonly base?: string | undefined;
  readonly vitestWorkers?: number | undefined;
  /** Replaces every step's own timeout. */
  readonly stepTimeout?: Duration.Input | undefined;
  readonly mongoPort?: number | undefined;
  readonly readyTimeout?: Duration.Input | undefined;
}

interface Command {
  readonly name: string;
  /** Arguments to pnpm, run at the worktree root. */
  readonly args: readonly string[];
  readonly timeout: Duration.Input;
  readonly env?: Readonly<Record<string, string>>;
  /** What a failure means, when the exit code alone doesn't say. */
  readonly explain?: (detail: string) => string;
}

const mobileScripts = (root: string): Record<string, string> => {
  const manifest = JSON.parse(readFileSync(join(root, 'apps/mobile/package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
};

/** Every verify:* script, in package order. verify:all would only run them again. */
const verifierNames = (root: string) =>
  Object.keys(mobileScripts(root)).filter(
    (name) => name.startsWith('verify:') && name !== 'verify:all',
  );

const seconds = (since: number) => Math.round((Date.now() - since) / 100) / 10;
const timeoutSeconds = (input: Duration.Input) => Math.round(Duration.toSeconds(input) * 10) / 10;

const inheritedEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

const resolveBase = (root: string, ref: string | undefined) =>
  Effect.gen(function* () {
    const processes = yield* Processes;
    const candidates = ref ? [ref] : ['origin/main', 'main'];
    for (const candidate of candidates) {
      const commit = yield* processes.output('git', ['merge-base', 'HEAD', candidate], root);
      if (commit) return { ref: candidate, commit };
    }
    return { ref: candidates[0] ?? 'origin/main', commit: undefined };
  });

/**
 * Runs the gate in a worktree. It never fails: every outcome is in the verdict, which is
 * printed and written to tools/swarm/out/verdict.json.
 */
export const gate = (
  options: GateOptions,
): Effect.Effect<Verdict, never, Processes | Databases | Network | Output> =>
  Effect.gen(function* () {
    const { root } = options;
    const processes = yield* Processes;
    const output = yield* Output;
    const started = Date.now();
    const vitestWorkers = options.vitestWorkers ?? defaultVitestWorkers;
    const commit = yield* processes.output('git', ['rev-parse', 'HEAD'], root);
    const base = yield* resolveBase(root, options.base);
    const steps: StepResult[] = [];
    let backend: Verdict['backend'];
    /** The step under way, so an interruption can name it. */
    let current:
      | { readonly name: string; readonly since: number; readonly log?: string }
      | undefined;

    const verdictOf = (interrupted: boolean): Verdict => ({
      verdict: interrupted || steps.some((step) => step.status === 'fail') ? 'fail' : 'pass',
      interrupted,
      worktree: root,
      commit,
      base,
      startedAt: new Date(started).toISOString(),
      seconds: seconds(started),
      vitestWorkers,
      backend,
      steps:
        interrupted && current
          ? [
              ...steps,
              {
                name: current.name,
                status: 'fail',
                seconds: seconds(current.since),
                detail: 'interrupted; its processes were stopped',
                log: current.log,
              },
            ]
          : steps,
    });

    const record = (step: StepResult) =>
      Effect.gen(function* () {
        current = undefined;
        steps.push(step);
        yield* output.line(stepLine(step, root));
        if (step.status === 'fail' && step.log) {
          const lines = logTail(step.log);
          if (lines) yield* output.line(lines.replace(/^/gm, '        | '));
        }
      });

    const skip = (names: readonly string[], detail: string) =>
      Effect.forEach(names, (name) => record({ name, status: 'skip', seconds: 0, detail }), {
        discard: true,
      });

    const logDirectory = join(outDirectory(root), 'gate');
    const runCommand = (command: Command) =>
      Effect.gen(function* () {
        mkdirSync(logDirectory, { recursive: true });
        const log = join(logDirectory, `${command.name.replace(/[^a-z0-9]+/gi, '-')}.log`);
        writeFileSync(log, '');
        const since = Date.now();
        current = { name: command.name, since, log };
        const timeout = options.stepTimeout ?? command.timeout;
        const detail = yield* processes
          .run({
            command: 'pnpm',
            args: command.args,
            cwd: root,
            env: { ...inheritedEnv(), ...command.env },
            log,
          })
          .pipe(
            Effect.map((finished) =>
              finished.exitCode === 0 ? undefined : `exit code ${finished.exitCode ?? 'none'}`,
            ),
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () =>
                Effect.succeed(
                  `timed out after ${timeoutSeconds(timeout)} s; its processes were stopped`,
                ),
            }),
            Effect.catch((error) => Effect.succeed(error.message)),
          );
        yield* record({
          name: command.name,
          status: detail === undefined ? 'pass' : 'fail',
          seconds: seconds(since),
          detail: detail === undefined ? undefined : (command.explain?.(detail) ?? detail),
          log,
        });
      });

    yield* output.line(`Gate in ${root}`);
    const verifiers = verifierNames(root);

    const run = Effect.gen(function* () {
      const install = checkInstall(root);
      yield* record({
        name: 'install check',
        status: install.ok ? 'pass' : 'fail',
        seconds: 0,
        detail: install.ok ? undefined : install.message.replace('\n', ' '),
      });
      if (!install.ok) {
        return yield* skip(
          ['lint', 'typecheck', 'format check', 'unit tests', 'ceilings', 'backend', ...verifiers],
          'skipped: the install check failed',
        );
      }

      yield* runCommand({ name: 'lint', args: ['lint'], timeout: timeouts.lint });
      yield* runCommand({ name: 'typecheck', args: ['typecheck'], timeout: timeouts.typecheck });
      yield* runCommand({ name: 'format check', args: ['format:check'], timeout: timeouts.format });
      // `pnpm test:unit` package by package, so the cap is the gate's total.
      yield* runCommand({
        name: 'unit tests',
        args: ['--recursive', '--workspace-concurrency=1', 'test:unit'],
        timeout: timeouts.unit,
        env: { VITEST_MAX_WORKERS: String(vitestWorkers) },
      });

      if (!(ceilingScript in mobileScripts(root))) {
        yield* record({
          name: 'ceilings',
          status: 'skip',
          seconds: 0,
          detail: 'No ceilings are recorded yet (#206), so there is nothing to compare.',
        });
      } else if (base.commit === undefined) {
        yield* record({
          name: 'ceilings',
          status: 'fail',
          seconds: 0,
          detail: `No base commit: ${base.ref} has no merge-base with HEAD.`,
        });
      } else {
        const baseCommit = base.commit;
        // #206's script exits non-zero when a ceiling rose or a journey was removed.
        yield* runCommand({
          name: 'ceilings',
          args: ['--dir', 'apps/mobile', 'run', ceilingScript, '--base', baseCommit],
          timeout: timeouts.ceilings,
          explain: (detail) =>
            `a render or request ceiling is higher than at ${baseCommit.slice(0, 7)}, so the pull request needs the re-record label (${detail})`,
        });
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          const since = Date.now();
          current = { name: 'backend', since };
          const outcome = yield* backendForScope({
            root,
            mongoPort: options.mongoPort,
            readyTimeout: options.readyTimeout,
          }).pipe(Effect.catch((error) => Effect.succeed(error.message)));
          if (typeof outcome === 'string') {
            yield* record({
              name: 'backend',
              status: 'fail',
              seconds: seconds(since),
              detail: outcome,
            });
            return yield* skip(verifiers, 'skipped: no backend');
          }
          backend = {
            origin: outcome.backend.origin,
            database: outcome.backend.database,
            startedByGate: outcome.startedHere,
          };
          yield* record({
            name: 'backend',
            status: 'pass',
            seconds: seconds(since),
            detail: outcome.startedHere
              ? `started at ${outcome.backend.origin}; stopped and dropped after the verifiers`
              : `reused the backend from pnpm swarm up at ${outcome.backend.origin}`,
          });
          for (const name of verifiers) {
            yield* runCommand({
              name,
              args: ['--dir', 'apps/mobile', 'run', name],
              timeout: timeouts.verifier,
              env: { MOBILE_VERIFY_URL: outcome.backend.origin, TZ: verifierTimeZone },
            });
          }
        }),
      );
    });

    yield* run.pipe(
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          const verdict = verdictOf(true);
          writeVerdict(verdict);
          yield* output.line(renderVerdict(verdict));
        }),
      ),
    );

    const verdict = verdictOf(false);
    writeVerdict(verdict);
    yield* output.line('');
    yield* output.line(renderVerdict(verdict));
    return verdict;
  });
