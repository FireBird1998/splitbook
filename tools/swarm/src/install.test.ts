import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkInstall, installFix } from './install.ts';

const lockfile = "lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n";
const fixtures: string[] = [];

/** A worktree with a root lockfile and, optionally, an installed one. */
function worktree(installed?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'swarm-install-'));
  fixtures.push(root);
  writeFileSync(join(root, 'pnpm-lock.yaml'), lockfile);
  if (installed !== undefined) {
    mkdirSync(join(root, 'node_modules/.pnpm'), { recursive: true });
    writeFileSync(join(root, 'node_modules/.pnpm/lock.yaml'), installed);
  }
  return root;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the install check', () => {
  it('fails in a worktree with no install, and prints the fix', () => {
    const result = checkInstall(worktree());
    expect(result).toMatchObject({ ok: false, problem: 'missing' });
    expect(result.message).toContain('no install');
    expect(result.message).toContain(installFix);
  });

  it('fails when node_modules exists but holds no installed lockfile', () => {
    const root = worktree();
    mkdirSync(join(root, 'node_modules'));
    expect(checkInstall(root)).toMatchObject({ ok: false, problem: 'missing' });
  });

  it('fails when the installed lockfile differs from pnpm-lock.yaml, and prints the fix', () => {
    const result = checkInstall(worktree(lockfile.replace('.: {}', 'apps/mobile: {}')));
    expect(result).toMatchObject({ ok: false, problem: 'stale' });
    expect(result.message).toContain('does not match pnpm-lock.yaml');
    expect(result.message).toContain(installFix);
  });

  it('passes once an install has written the same lockfile to node_modules/.pnpm', () => {
    const root = worktree(lockfile.replace('.: {}', 'apps/mobile: {}'));
    expect(checkInstall(root).ok).toBe(false);
    // pnpm install --frozen-lockfile --offline writes pnpm-lock.yaml to node_modules/.pnpm/lock.yaml.
    copyFileSync(join(root, 'pnpm-lock.yaml'), join(root, 'node_modules/.pnpm/lock.yaml'));
    expect(checkInstall(root)).toMatchObject({ ok: true, problem: undefined });
  });

  it('fails when the worktree has no pnpm-lock.yaml at all', () => {
    const root = worktree();
    rmSync(join(root, 'pnpm-lock.yaml'));
    expect(checkInstall(root)).toMatchObject({ ok: false, problem: 'no-lockfile' });
  });

  it('names the offline install as the fix', () => {
    expect(installFix).toBe('pnpm install --frozen-lockfile --offline');
  });
});
