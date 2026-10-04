/**
 * The gate's verdict: printed for the agent, and written as JSON for the orchestrator.
 * Node built-ins only, so the CLI can write a verdict even when the install is missing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** vitest workers per gate, so gates running at once don't fight over the CPU. */
export const defaultVitestWorkers = 2;

export type StepStatus = 'pass' | 'fail' | 'skip';

export interface StepResult {
  readonly name: string;
  readonly status: StepStatus;
  readonly seconds: number;
  readonly detail?: string | undefined;
  /** The step's output, for a step that ran a process. */
  readonly log?: string | undefined;
}

export interface Verdict {
  readonly verdict: 'pass' | 'fail';
  /** True when Ctrl-C or a signal stopped the gate before it finished. */
  readonly interrupted: boolean;
  readonly worktree: string;
  /** The worktree's commit, or undefined outside git. */
  readonly commit: string | undefined;
  /** The base commit the ceilings compare with: the merge-base with `ref`. */
  readonly base: { readonly ref: string; readonly commit: string | undefined };
  readonly startedAt: string;
  readonly seconds: number;
  readonly vitestWorkers: number;
  readonly backend:
    | { readonly origin: string; readonly database: string; readonly startedByGate: boolean }
    | undefined;
  readonly steps: readonly StepResult[];
}

export const verdictPath = (root: string) => join(root, 'tools/swarm/out/verdict.json');

/** A step's status and time, as one printed line. */
export function stepLine(step: StepResult, root: string): string {
  const detail = [step.detail, step.log && `log ${relative(root, step.log)}`]
    .filter(Boolean)
    .join('; ');
  return `  ${step.status.toUpperCase().padEnd(4)}  ${step.name.padEnd(20)} ${step.seconds
    .toFixed(1)
    .padStart(6)} s${detail ? `  ${detail}` : ''}`;
}

const short = (commit: string | undefined) => commit?.slice(0, 7) ?? 'unknown';

/** The verdict as printed: the outcome, the commit and base, then every step. */
export function renderVerdict(verdict: Verdict): string {
  const failed = verdict.steps.filter((step) => step.status === 'fail').length;
  const summary = verdict.interrupted
    ? `Interrupted after ${verdict.steps.length} steps`
    : failed
      ? `${failed} of ${verdict.steps.length} steps failed`
      : 'No step failed';
  return [
    `Gate: ${verdict.verdict.toUpperCase()}${verdict.interrupted ? ' (interrupted)' : ''}`,
    `Worktree ${verdict.worktree}`,
    `Commit ${short(verdict.commit)}, base ${short(verdict.base.commit)} (merge-base with ${verdict.base.ref})`,
    ...verdict.steps.map((step) => stepLine(step, verdict.worktree)),
    `${summary} in ${verdict.seconds.toFixed(1)} s. JSON: ${relative(verdict.worktree, verdictPath(verdict.worktree))}`,
  ].join('\n');
}

export function writeVerdict(verdict: Verdict): void {
  const path = verdictPath(verdict.worktree);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(verdict, null, 2)}\n`);
}
