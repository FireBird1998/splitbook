/**
 * ADR 0006 allows Effect only in standalone tooling, and tools/brand keeps its own npm
 * lockfile. These checks run in CI with the rest of the workspace's unit tests.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repository = resolve(import.meta.dirname, '../../..');

interface Manifest {
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const manifest = (path: string) =>
  JSON.parse(readFileSync(join(repository, path, 'package.json'), 'utf8')) as Manifest;

const dependencyNames = (pkg: Manifest) =>
  [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies].flatMap(
    (field) => Object.keys(field ?? {}),
  );

describe('the workspace', () => {
  it('has no package under apps/ or packages/ that depends on Effect (ADR 0006)', () => {
    const packages = ['apps', 'packages'].flatMap((directory) =>
      readdirSync(join(repository, directory))
        .map((name) => `${directory}/${name}`)
        .filter((path) => existsSync(join(repository, path, 'package.json'))),
    );
    expect(packages).toContain('apps/mobile');
    expect(packages).toContain('apps/web');
    expect(packages).toContain('packages/shared');
    for (const path of packages) {
      const effect = dependencyNames(manifest(path)).filter(
        (name) => name === 'effect' || name.startsWith('@effect/'),
      );
      expect({ path, effect }).toEqual({ path, effect: [] });
    }
  });

  it('lists tools/swarm but not tools/*, so tools/brand keeps its own npm lockfile', () => {
    const workspace = readFileSync(join(repository, 'pnpm-workspace.yaml'), 'utf8');
    const entries = [...workspace.matchAll(/^\s*-\s*['"]?([^'"\s#]+)/gm)].map((match) => match[1]);
    expect(entries).toContain('tools/swarm');
    expect(entries.filter((entry) => entry?.startsWith('tools/'))).toEqual(['tools/swarm']);
    expect(existsSync(join(repository, 'tools/brand/package-lock.json'))).toBe(true);
  });

  it('gives tools/swarm Effect 4 and the Node 22.18 floor Effect 4 needs', () => {
    const swarm = manifest('tools/swarm');
    expect(swarm.dependencies?.effect).toMatch(/^\^4\./);
    expect(swarm.engines?.node).toBe('>=22.18');
  });
});
