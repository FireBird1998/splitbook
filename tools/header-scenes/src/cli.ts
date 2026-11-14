import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildScenes, generatedFiles, OUTPUT, staleOutputs } from './generate.ts';
import {
  listFiles,
  listSource,
  renderSprite,
  SPRITE_IMAGES,
  SPRITE_LISTS,
  spriteList,
  spritePlans,
  spriteSource,
} from './sprites.ts';

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

// Android's pictures. A list is fresh when it records the hash of today's drawing input and every
// picture it names exists; PNG bytes are never compared, so the check agrees across platforms.
const images = resolve(root, SPRITE_IMAGES);
const lists = resolve(root, SPRITE_LISTS);
const staleSprites: string[] = [];
const wanted = new Set<string>();
for (const scene of buildScenes()) {
  const list = resolve(lists, `${scene.id}.ts`);
  const text = existsSync(list) ? readFileSync(list, 'utf8') : '';
  const fresh =
    listSource(text) === spriteSource(scene) &&
    listFiles(text).length === spritePlans(scene).length &&
    listFiles(text).every((file) => existsSync(resolve(images, file)));
  if (fresh) {
    listFiles(text).forEach((file) => wanted.add(file));
    continue;
  }
  staleSprites.push(`${scene.id}.ts`);
  if (command !== 'build') continue;
  mkdirSync(images, { recursive: true });
  mkdirSync(lists, { recursive: true });
  const sprites = [];
  for (const plan of spritePlans(scene)) sprites.push(await renderSprite(plan));
  for (const sprite of sprites) {
    writeFileSync(resolve(images, sprite.file), sprite.png);
    wanted.add(sprite.file);
  }
  writeFileSync(list, spriteList(scene, sprites));
}
const extra = (existsSync(images) ? readdirSync(images) : []).filter(
  (file) => file.endsWith('.png') && !wanted.has(file),
);
if (command === 'build') {
  for (const file of extra) rmSync(resolve(images, file));
  console.log(`Built ${wanted.size} Header scene pictures in ${SPRITE_IMAGES}.`);
} else if (staleSprites.length || extra.length) {
  console.error(
    `Stale Header scene pictures: ${[...staleSprites, ...extra].join(', ')}. Run pnpm --filter @splitbook/header-scenes build.`,
  );
  process.exitCode = 1;
} else console.log(`Header scene pictures match their drawing input (${wanted.size} files).`);
