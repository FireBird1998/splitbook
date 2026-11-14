import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import { buildScenes } from './generate';
import {
  listFiles,
  listSource,
  renderSprite,
  spriteList,
  spritePlans,
  spriteSource,
  thumbnailList,
} from './sprites';

// These tests draw pictures with sharp; CI's runners are several times slower than a laptop.
vi.setConfig({ testTimeout: 30_000 });

const scenes = buildScenes();

it.each(scenes.map((scene) => [scene.id, scene] as const))(
  '%s splits into a body per layer, one ground shadow and separately drifting clouds',
  (_, scene) => {
    const plans = spritePlans(scene);
    for (const layer of ['far', 'main', 'front', 'glow'] as const)
      expect(
        plans.filter(
          (plan) => plan.layer === layer && plan.kind === 'body' && plan.file.endsWith('-body.png'),
        ),
      ).toHaveLength(1);
    // Only Beach has a second island in its main layer; it is a picture of its own.
    expect(plans.filter((plan) => plan.file.endsWith('-main-side.png'))).toHaveLength(
      scene.id === 'beach' ? 1 : 0,
    );
    expect(plans.filter((plan) => plan.kind === 'shadow')).toHaveLength(1);
    const clouds = plans.filter((plan) => plan.kind === 'cloud');
    expect(clouds.length).toBeGreaterThanOrEqual(5);
    for (const cloud of clouds) expect([140, 160, 180, 210, 260, 320]).toContain(cloud.seconds);
    expect(new Set(plans.map((plan) => plan.file)).size).toBe(plans.length);
    // The shadow lies under the island, and a layer's clouds pass in front of its body.
    const main = plans.filter((plan) => plan.layer === 'main').map((plan) => plan.kind);
    expect(main.indexOf('shadow')).toBeLessThan(main.lastIndexOf('body'));
  },
);

it('draws a trimmed, decodable picture and records where it sits in the scene', async () => {
  const scene = scenes.find((each) => each.id === 'sakura')!;
  const plan = spritePlans(scene).find((each) => each.file === 'sakura-clouds-cloud-1.png')!;
  const sprite = await renderSprite(plan);
  const { width, height, hasAlpha } = await sharp(sprite.png).metadata();
  expect(hasAlpha).toBe(true);
  // Three pixels per scene unit, so the phone never scales a picture up.
  expect(width! / sprite.w).toBeCloseTo(3, 1);
  expect(height! / sprite.h).toBeCloseTo(3, 1);
  // The traced cloud rests near the top left of the scene.
  expect(sprite.x).toBeGreaterThan(0);
  expect(sprite.x + sprite.w).toBeLessThan(200);
  expect(sprite.y).toBeGreaterThan(0);
  expect(sprite.y + sprite.h).toBeLessThan(90);
});

it('a list records the hash of its drawing input and the pictures it needs', async () => {
  const scene = scenes.find((each) => each.id === 'beach')!;
  const plans = spritePlans(scene).filter((plan) => plan.kind === 'cloud');
  const sprites = [];
  for (const plan of plans) sprites.push(await renderSprite(plan));
  const text = spriteList(scene, sprites);
  expect(listSource(text)).toBe(spriteSource(scene));
  expect(listFiles(text)).toEqual(plans.map((plan) => plan.file));
  expect(text).toContain(JSON.stringify(scene.description));
  expect(listSource('const scene = {};')).toBeNull();
  // Any change to the art changes the hash, so a stale list fails the check.
  const changed = structuredClone(scene);
  changed.layers.main.children![0]!.props.transform = 'translate(1 1)';
  expect(spriteSource(changed)).not.toBe(spriteSource(scene));
});

it('lists the main island of every scene as its settings thumbnail', () => {
  const text = thumbnailList(scenes);
  for (const scene of scenes) {
    expect(text).toContain(`assets/header-scenes/${scene.id}-main-body.png`);
    expect(spritePlans(scene).some((plan) => plan.file === `${scene.id}-main-body.png`)).toBe(true);
  }
});

it.each(scenes.map((scene) => [scene.id, scene] as const))(
  '%s night windows are drawn in the lit colour the web sets in CSS, never the default black',
  (_, scene) => {
    const glow = spritePlans(scene).find((plan) => plan.layer === 'glow')!.svg;
    const windows = /<g class="[^"]*\bwins\b[^"]*">(.*?)<\/g>/.exec(glow)![1]!;
    const shapes = windows.match(/<(polygon|path|rect|circle)\b[^>]*>/g)!;
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) expect(shape).toContain('fill="#ffd98a"');
  },
);

it('keeps every committed picture within the oldest GPUs texture limit', async () => {
  const { readdirSync } = await import('node:fs');
  const directory = new URL('../../../apps/mobile/assets/header-scenes/', import.meta.url);
  const files = readdirSync(directory).filter((file) => file.endsWith('.png'));
  expect(files.length).toBe(scenes.flatMap(spritePlans).length);
  for (const file of files) {
    const { width, height } = await sharp(new URL(file, directory).pathname).metadata();
    expect(Math.max(width!, height!), file).toBeLessThanOrEqual(2048);
  }
});
