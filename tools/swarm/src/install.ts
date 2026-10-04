/**
 * The install check. A stale install looks like broken code: missing packages fail
 * rendered tests and typecheck. So `check` runs before anything else, and the gate
 * runs it first.
 *
 * This module imports no package, only Node built-ins, so `pnpm swarm check` works in a
 * worktree that has no install at all (no `effect` to load).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The fix the check prints. About 10 s with a warm pnpm store. */
export const installFix = 'pnpm install --frozen-lockfile --offline';

export type InstallCheck =
  | { readonly ok: true; readonly problem: undefined; readonly message: string }
  | {
      readonly ok: false;
      readonly problem: 'no-lockfile' | 'missing' | 'stale';
      readonly message: string;
    };

function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Compares the lockfile pnpm last installed (`node_modules/.pnpm/lock.yaml`) with the
 * worktree's `pnpm-lock.yaml`. A fresh `pnpm install --frozen-lockfile` writes the
 * same bytes to both, so any difference means the install is stale.
 */
export function checkInstall(root: string): InstallCheck {
  const wanted = read(join(root, 'pnpm-lock.yaml'));
  if (wanted === undefined) {
    return {
      ok: false,
      problem: 'no-lockfile',
      message: `There is no pnpm-lock.yaml in ${root}. Run the check from a Splitbook worktree.`,
    };
  }
  const installed = read(join(root, 'node_modules/.pnpm/lock.yaml'));
  if (installed === undefined) {
    return {
      ok: false,
      problem: 'missing',
      message:
        `This worktree has no install (node_modules/.pnpm/lock.yaml is missing).\n` +
        `Fix: ${installFix}`,
    };
  }
  if (installed !== wanted) {
    return {
      ok: false,
      problem: 'stale',
      message:
        `The install does not match pnpm-lock.yaml (node_modules/.pnpm/lock.yaml differs), ` +
        `so tests and typecheck would fail for the wrong reason.\n` +
        `Fix: ${installFix}`,
    };
  }
  return {
    ok: true,
    problem: undefined,
    message: 'The install matches pnpm-lock.yaml.',
  };
}
