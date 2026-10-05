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
 * backend the gate started. The gate holds the worktree lock while it runs, and no step
 * inherits credentials or another backend's variables.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Duration, Effect } from 'effect';
import { backendForScope, backendVariables, logTail, outDirectory } from './backend.ts';
import { checkInstall } from './install.ts';
import { withWorktreeLock } from './lock.ts';
import {
  Output,
  Processes,
  type Databases,
  type Network,
  type ProcessFailed,
  type Refused,
} from './platform.ts';
import {
  defaultVitestWorkers,
  renderVerdict,
  stepLine,
  writeVerdict,
  type StepResult,
  type Verdict,
} from './verdict.ts';

export { defaultVitestWorkers, verdictPath, type StepResult, type Verdict } from './verdict.ts';

/** #206's ratchet in apps/mobile/package.json; the gate calls it, never a copy. */
export const ceilingScript = 'ceilings:compare';
/** The label that allows a re-record; in CI it counts only when an approver applied it. */
const reRecordLabel = 're-record-ceilings';
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

/** apps/mobile's scripts, or why they could not be read. */
function mobileScripts(root: string): Record<string, string> | string {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'apps/mobile/package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return manifest.scripts ?? {};
  } catch (error) {
    return `Could not read apps/mobile/package.json: ${(error as Error).message}`;
  }
}

/** Every verify:* script, in package order. verify:all would only run them again. */
const verifierNames = (scripts: Record<string, string>) =>
  Object.keys(scripts).filter((name) => name.startsWith('verify:') && name !== 'verify:all');

const seconds = (since: number) => Math.round((Date.now() - since) / 100) / 10;
const timeoutSeconds = (input: Duration.Input) => Math.round(Duration.toSeconds(input) * 10) / 10;

/**
 * Variables no step inherits: database and auth settings, credentials of any kind, and
 * another backend's variables. The verifiers get this backend's own instead.
 */
const scrubbed = [
  /^MONGO/i,
  /^TEST_MONGO/i,
  /^DATABASE_URL$/i,
  /^AUTH_/i,
  /^BETTER_AUTH/i,
  /^NEXTAUTH/i,
  /^GOOGLE_/i,
  /^ALLOW_/i,
  /^NEXT_PUBLIC_/i,
  /^SPLITBOOK_/i,
  /^MOBILE_VERIFY_URL$/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /API_?KEY/i,
  /PRIVATE_?KEY/i,
  /ACCESS_?KEY/i,
];

const stepEnvironment = (extra: Readonly<Record<string, string>> = {}) => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !scrubbed.some((pattern) => pattern.test(entry[0])),
    ),
  ),
  ...extra,
});

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
 * Runs the gate in a worktree. Every outcome is in the verdict, which is printed and
 * written to tools/swarm/out/verdict.json. It fails only when it can't take the worktree
 * lock, because another swarm command is running there; then it writes no verdict.
 */
export const gate = (
  options: GateOptions,
): Effect.Effect<Verdict, Refused | ProcessFailed, Processes | Databases | Network | Output> =>
  withWorktreeLock(options.root, 'gate', gateUnlocked(options));

const gateUnlocked = (
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
        const since = Date.now();
        const log = join(logDirectory, `${command.name.replace(/[^a-z0-9]+/gi, '-')}.log`);
        const unwritable = yield* Effect.try({
          try: () => {
            mkdirSync(logDirectory, { recursive: true });
            writeFileSync(log, '');
          },
          catch: (error) => `Could not write ${log}: ${(error as Error).message}`,
        }).pipe(
          Effect.as(undefined),
          Effect.catch((message) => Effect.succeed(message)),
        );
        if (unwritable) {
          return yield* record({
            name: command.name,
            status: 'fail',
            seconds: 0,
            detail: unwritable,
          });
        }
        current = { name: command.name, since, log };
        const timeout = options.stepTimeout ?? command.timeout;
        const detail = yield* processes
          .run({
            command: 'pnpm',
            args: command.args,
            cwd: root,
            env: stepEnvironment(command.env),
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
    const scripts = mobileScripts(root);
    const verifiers = typeof scripts === 'string' ? [] : verifierNames(scripts);

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

      if (typeof scripts === 'string') {
        yield* record({ name: 'verifiers', status: 'fail', seconds: 0, detail: scripts });
        return yield* skip(['ceilings', 'backend'], 'skipped: no list of verifiers');
      }
      if (!(ceilingScript in scripts)) {
        yield* record({
          name: 'ceilings',
          status: 'skip',
          seconds: 0,
          detail: `No ceilings are recorded on this branch: apps/mobile/package.json has no ${ceilingScript} script (#206).`,
        });
      } else if (base.commit === undefined) {
        yield* record({
          name: 'ceilings',
          status: 'fail',
          seconds: 0,
          detail: `No base commit: ${base.ref} has no merge-base with HEAD.`,
        });
      } else {
        const since = base.commit.slice(0, 7);
        // Without a pull request the script can't see a label, so it reports what would need
        // one: exit code 1 when a ceiling rose or a journey was removed or renamed, and 2
        // when it could not compare.
        yield* runCommand({
          name: 'ceilings',
          args: ['--dir', 'apps/mobile', 'run', ceilingScript, '--base', base.commit],
          timeout: timeouts.ceilings,
          explain: (detail) =>
            detail === 'exit code 1'
              ? `a ceiling rose, or a journey was removed or renamed, since ${since}, so the pull request needs the ${reRecordLabel} label from an approver (${detail}); the log lists each change`
              : `the ceilings could not be compared with ${since} (${detail}); the log says why`,
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
              // This backend's variables, so a control.mjs run hits this worktree's database.
              env: { ...backendVariables(outcome.backend), TZ: verifierTimeZone },
            });
          }
        }),
      );
    });

    const save = (verdict: Verdict) =>
      Effect.try({
        try: () => writeVerdict(verdict),
        catch: (error) => (error as Error).message,
      }).pipe(
        Effect.catch((message) => output.line(`Could not write the verdict: ${message}`)),
        Effect.andThen(output.line(renderVerdict(verdict))),
      );

    yield* run.pipe(Effect.onInterrupt(() => save(verdictOf(true))));

    const verdict = verdictOf(false);
    yield* output.line('');
    yield* save(verdict);
    return verdict;
  });
