/**
 * How an Android HTTP verifier reports a failure (#478): what it checked, the command that reruns
 * it, and what it expected beside what it saw, so a red run can be read without digging. Nothing
 * that could be a credential is printed: a cookie, token, secret, password, session or
 * authorization value is redacted wherever it sits.
 */
import { AssertionError } from 'node:assert';
import { inspect } from 'node:util';

const SECRET_KEY = /cookie|token|secret|password|authorization|session/i;
const REDACTED = '[redacted]';

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (value instanceof Date || value instanceof Map || value instanceof Set) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? REDACTED : redact(item, seen),
    ]),
  );
}

const show = (value: unknown) =>
  inspect(redact(value), { depth: 4, breakLength: Infinity, maxArrayLength: 30, compact: true });

/** The operator `observe` gives the checks it fails, so the report shows its snapshot. */
const OBSERVED = 'observe';

/**
 * Fails, like `assert.ok`, when `condition` is false, carrying `snapshot`: the values the check
 * looked at, so the report says what was seen and not only that something was wrong.
 */
export function observe(condition: unknown, message: string, snapshot: unknown): asserts condition {
  if (!condition)
    throw new AssertionError({
      message,
      actual: snapshot,
      operator: OBSERVED,
      stackStartFn: observe,
    });
}

/**
 * The verifier's failure: its message, the command that reruns it, then expected and observed.
 * `unexpected`, when given, is said for anything that isn't a check instead of its own text,
 * which could hold a URL or a response.
 */
export function failureReport(error: unknown, command: string, unexpected?: string): string {
  const message =
    error instanceof AssertionError
      ? // Node adds its own diff after a check's message; the report shows the values below.
        error.generatedMessage
        ? 'A check failed.'
        : error.message.split('\n')[0]
      : unexpected !== undefined
        ? unexpected
        : error instanceof Error
          ? error.message
          : String(error);
  const lines = [`FAIL: ${message}`, `  command: ${command}`];
  if (error instanceof AssertionError) {
    if (error.operator === OBSERVED) lines.push(`  observed: ${show(error.actual)}`);
    // A bare `assert.ok` knows only that its condition was false, which says nothing more.
    else if (error.operator !== '==' || error.expected !== true)
      lines.push(`  expected: ${show(error.expected)}`, `  observed: ${show(error.actual)}`);
  }
  return lines.join('\n');
}

/** The command that reruns this verifier: the package script pnpm ran, or the script itself. */
export function verifierCommand(
  env: Readonly<Record<string, string | undefined>> = process.env,
  argv: readonly string[] = process.argv,
): string {
  const script = env.npm_lifecycle_event;
  if (script?.startsWith('verify:')) return `pnpm --filter @splitbook/mobile run ${script}`;
  const file = argv[1] ?? '';
  const at = file.lastIndexOf('apps/mobile/');
  return `node --import tsx ${at >= 0 ? file.slice(at) : file}`;
}

/**
 * A verifier's last handler: prints the report and fails the run. `unexpected` is said instead of
 * the text of anything that isn't a check (see `failureReport`); without it, an unexpected error
 * says its own message, and anything that isn't an error says "Verification failed".
 */
export function reportVerifierFailure(error: unknown, unexpected?: string): void {
  console.error(
    failureReport(
      error instanceof Error ? error : new Error('Verification failed'),
      verifierCommand(),
      unexpected,
    ),
  );
  process.exitCode = 1;
}
