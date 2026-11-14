import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generatedFiles, OUTPUT, staleOutputs } from './generate.ts';

const root = resolve(import.meta.dirname, '../../..');
const directory = resolve(root, OUTPUT);
const command = process.argv[2];
if (!['build', 'check'].includes(command))
  throw new Error('Usage: pnpm --filter @splitbook/header-scenes <build|check>');
const expected = await generatedFiles(command === 'build');
const actual = new Map(
  (existsSync(directory) ? readdirSync(directory, { withFileTypes: true }) : [])
    .filter((file) => file.isFile())
    .map((file) => [file.name, readFileSync(resolve(directory, file.name), 'utf8')]) ?? [],
);
const stale = staleOutputs(expected, actual);
if (command === 'build') {
  mkdirSync(directory, { recursive: true });
  for (const path of new Set([...stale, 'thumbnails.ts'])) {
    const text = expected.get(path);
    if (text === undefined) rmSync(resolve(directory, path));
    else writeFileSync(resolve(directory, path), text);
  }
  console.log(`Built ${expected.size} Header scene files in ${OUTPUT}.`);
} else if (stale.length) {
  console.error(
    `Stale Header scene output: ${stale.join(', ')}. Run pnpm --filter @splitbook/header-scenes build.`,
  );
  process.exitCode = 1;
} else console.log(`Header scenes match a fresh build (${expected.size} files).`);
