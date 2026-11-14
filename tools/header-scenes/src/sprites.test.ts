import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import type { HeaderSceneArt, SceneVector } from '@splitbook/shared/header-scene-art';
import { buildScenes } from './generate';
import {
  listFiles,
  layerSvg,
  listSource,
  DRAWN,
  renderScene,
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

it('lists a whole-island thumbnail for every scene', () => {
  const text = thumbnailList(scenes);
  for (const scene of scenes) {
    expect(text).toContain(`assets/header-scenes/${scene.id}-thumb.png`);
    const thumb = spritePlans(scene).find((plan) => plan.file === `${scene.id}-thumb.png`)!;
    // The thumbnail keeps the parts the island's body picture no longer holds.
    expect(thumb.svg.length).toBeGreaterThan(
      spritePlans(scene).find((plan) => plan.file === `${scene.id}-main-body.png`)!.svg.length,
    );
  }
});

it.each(scenes.map((scene) => [scene.id, scene] as const))(
  '%s night windows are drawn in the lit colour the web sets in CSS, never the default black',
  (_, scene) => {
    // The windows flicker at night, so they are parts of the glow layer, some of them several.
    const shapes = spritePlans(scene)
      .filter((plan) => plan.layer === 'glow')
      .flatMap((plan) => [...plan.svg.matchAll(/<g class="[^"]*\bwins\b[^"]*">(.*?)<\/g>/g)])
      .flatMap((windows) => windows[1]!.match(/<(polygon|path|rect|circle)\b[^>]*>/g) ?? []);
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) expect(shape).toContain('fill="#ffd98a"');
  },
);

it('keeps every committed picture within the oldest GPUs texture limit', async () => {
  const { readdirSync } = await import('node:fs');
  const directory = new URL('../../../apps/mobile/assets/header-scenes/', import.meta.url);
  const files = readdirSync(directory).filter((file) => file.endsWith('.png'));
  // Every planned picture is there; covers are found while drawing and come on top.
  for (const plan of scenes.flatMap(spritePlans)) expect(files).toContain(plan.file);
  for (const file of files) {
    const { width, height } = await sharp(new URL(file, directory).pathname).metadata();
    expect(Math.max(width!, height!), file).toBeLessThanOrEqual(2048);
  }
});

/** The moving elements the art names, by class list: neither the float nor the clouds. */
function tagged(scene: HeaderSceneArt) {
  const found: string[] = [];
  const walk = (node: SceneVector) => {
    if (node.motion && node.motion !== 'float' && node.motion !== 'clouds')
      found.push(node.classes!.join(' '));
    node.children?.forEach(walk);
  };
  Object.values(scene.layers).forEach(walk);
  return found;
}
// Tagged, but the web only changes their brightness with the time of day; nothing moves.
const STILL_ON_THE_WEB = ['door-glow', 'lit'];

const SHAPE = /<(path|polygon|circle|ellipse|rect)\b/g;
/** The shapes drawn inside elements the art marks as moving, per class list of the marked element. */
function movingShapes(scene: HeaderSceneArt) {
  let shapes = 0;
  const classes = new Set<string>();
  const walk = (node: SceneVector, inside: boolean) => {
    const marked =
      node.motion !== undefined &&
      node.motion !== 'float' &&
      node.motion !== 'clouds' &&
      !node.classes!.some((name) => STILL_ON_THE_WEB.includes(name));
    if (marked) classes.add(node.classes!.join(' '));
    if ((inside || marked) && ['path', 'polygon', 'circle', 'ellipse', 'rect'].includes(node.tag))
      shapes++;
    node.children?.forEach((child) => walk(child, inside || marked));
  };
  Object.values(scene.layers).forEach((layer) => walk(layer, false));
  return { shapes, classes };
}

it.each(scenes.map((scene) => [scene.id, scene] as const))(
  '%s: every shape the art marks as moving is in exactly one part picture, and none is in a still body',
  (_, scene) => {
    const plans = spritePlans(scene);
    const parts = plans.filter((plan) => plan.kind === 'part');
    const bodies = plans
      .filter((plan) => plan.kind === 'body')
      .map((plan) => plan.svg)
      .join('');
    const { shapes, classes } = movingShapes(scene);
    expect(tagged(scene).length).toBeGreaterThan(20);
    // Shapes are never repeated as wrappers are, so the count is exact: one missing drop fails.
    expect(parts.reduce((sum, plan) => sum + (plan.svg.match(SHAPE)?.length ?? 0), 0)).toBe(shapes);
    for (const names of classes) expect(bodies, names).not.toContain(`class="${names}"`);
    for (const plan of parts) {
      expect(plan.tracks!.length, plan.file).toBeGreaterThan(0);
      for (const track of plan.tracks!) {
        expect(track.seconds).toBeGreaterThan(0);
        // The phone rejects a range that does not rise strictly.
        for (const curve of [track.x, track.y, track.scale, track.rotate, track.opacity])
          if (curve) {
            expect(curve.at[0]).toBe(0);
            expect(curve.at.at(-1)).toBe(1);
            expect(curve.to).toHaveLength(curve.at.length);
            for (let i = 1; i < curve.at.length; i++)
              expect(curve.at[i]!, `${plan.file}: ${curve.at}`).toBeGreaterThan(curve.at[i - 1]!);
          }
      }
    }
  },
);

it.each(scenes.map((scene) => [scene.id, scene] as const))(
  '%s: every committed part picture decodes and is trimmed to what it shows',
  async (_, scene) => {
    const { readFileSync } = await import('node:fs');
    const directory = new URL('../../../apps/mobile/assets/header-scenes/', import.meta.url);
    const parts = (await renderScene(scene)).filter((sprite) => sprite.kind === 'part');
    expect(parts.length).toBeGreaterThan(20);
    for (const part of parts) {
      const { data, info } = await sharp(readFileSync(new URL(part.file, directory)))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info.width / part.w, part.file).toBeCloseTo(3, 0);
      let [left, top, right, bottom] = [info.width, info.height, -1, -1];
      for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++)
          if (data[(y * info.width + x) * 4 + 3]! > 0) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
      expect(right, part.file).toBeGreaterThanOrEqual(0);
      // A rotor keeps its hub in the middle, so it may have empty margins; nothing else does.
      if (part.slant) continue;
      for (const margin of [left, top, info.width - 1 - right, info.height - 1 - bottom])
        expect(margin, part.file).toBeLessThanOrEqual(3);
    }
  },
);

it('gives each scene the movement the owner listed', () => {
  const kinds = (id: string) => {
    const scene = scenes.find((each) => each.id === id)!;
    const seen = new Set<string>();
    const walk = (node: SceneVector) => {
      if (node.motion) seen.add(node.motion);
      node.children?.forEach(walk);
    };
    Object.values(scene.layers).forEach(walk);
    return seen;
  };
  expect([...kinds('beach')]).toEqual(
    expect.arrayContaining(['water', 'animals', 'people', 'birds', 'boat']),
  );
  expect([...kinds('sakura')]).toEqual(
    expect.arrayContaining(['water', 'animals', 'people', 'birds', 'petals']),
  );
  expect([...kinds('eco-city')]).toEqual(
    expect.arrayContaining(['water', 'people', 'birds', 'turbines']),
  );
  expect([...kinds('mountain-village')]).toEqual(
    expect.arrayContaining(['water', 'people', 'birds', 'smoke', 'snow']),
  );
});

it('the pieces of a layer, put back in place, are the layer drawn whole', async () => {
  const scene = scenes.find((each) => each.id === 'sakura')!;
  const { scale, area } = DRAWN;
  const size = { width: area.width * scale, height: area.height * scale };
  const whole = await sharp(Buffer.from(layerSvg(scene, 'main')))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const pieces = [];
  for (const sprite of (await renderScene(scene)).filter(
    (each) => each.layer === 'main' && each.kind !== 'thumb' && each.kind !== 'shadow',
  ))
    pieces.push({
      input: await sharp(sprite.png)
        .resize(Math.round(sprite.w * scale), Math.round(sprite.h * scale), { fit: 'fill' })
        .png()
        .toBuffer(),
      left: Math.round((sprite.x - area.x) * scale),
      top: Math.round((sprite.y - area.y) * scale),
    });
  const made = await sharp({
    create: { ...size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(pieces)
    .raw()
    .toBuffer();
  let drawn = 0;
  let differing = 0;
  for (let i = 0; i < whole.length; i += 4) {
    if (whole[i + 3]! > 8 || made[i + 3]! > 8) drawn++;
    const colour =
      Math.abs(whole[i]! - made[i]!) +
      Math.abs(whole[i + 1]! - made[i + 1]!) +
      Math.abs(whole[i + 2]! - made[i + 2]!);
    if (colour > 60 || Math.abs(whole[i + 3]! - made[i + 3]!) > 60) differing++;
  }
  expect(drawn).toBeGreaterThan(100_000);
  // Palette colours and soft edges differ a little; a missing or misplaced part would not.
  expect(differing / drawn).toBeLessThan(0.01);
});

it('draws the art in front of a moving part again, on top of it', async () => {
  const shape = (x: number, fill: string): SceneVector => ({
    tag: 'rect',
    props: { x: String(x), y: '100', width: '20', height: '20', fill },
  });
  const scene: HeaderSceneArt = {
    ...structuredClone(scenes[0]!),
    css: '.vq .walker { animation: stroll 10s linear infinite; } @keyframes stroll { from { transform: translate(0, 0) } to { transform: translate(30px, 0) } }',
  };
  scene.layers.main = {
    tag: 'svg',
    props: {},
    children: [
      {
        tag: 'g',
        props: { transform: 'translate(300 0)' },
        children: [
          shape(-60, '#111111'),
          {
            tag: 'g',
            props: {},
            classes: ['walker'],
            motion: 'people',
            children: [shape(0, '#cc0000')],
          },
          // A tree the walker passes behind, and a rock it never reaches.
          shape(35, '#00aa00'),
          shape(120, '#0000aa'),
        ],
      },
    ],
  };
  const main = (await renderScene(scene)).filter((sprite) => sprite.layer === 'main');
  expect(main.map((sprite) => sprite.kind)).toEqual(['body', 'part', 'cover', 'thumb']);
  const [body, walker, cover] = main;
  // The walker rests at 300 and reaches 350; the tree at 335 to 355 is cut where he can be.
  expect(walker!.x).toBeCloseTo(300 - 2 / 3, 0);
  expect(walker!.tracks).toEqual([{ seconds: 10, x: { at: [0, 1], to: [0, 30] } }]);
  expect(cover!.x).toBeGreaterThanOrEqual(334);
  expect(cover!.x + cover!.w).toBeLessThanOrEqual(353);
  // The body still holds everything that does not move.
  expect(body!.x).toBeLessThan(241);
  expect(body!.x + body!.w).toBeGreaterThan(439);
});

it('equal specks share a picture only when no still art is drawn between them', () => {
  const speck = (x: number, between?: SceneVector): SceneVector[] => [
    {
      tag: 'rect',
      props: { x: String(x), y: '100', width: '2', height: '2', fill: '#ffffff' },
      classes: ['drop'],
      motion: 'water',
    },
    ...(between ? [between] : []),
  ];
  const rock: SceneVector = {
    tag: 'rect',
    props: { x: '6', y: '98', width: '6', height: '8', fill: '#555555' },
  };
  const scene = (children: SceneVector[]): HeaderSceneArt => ({
    ...structuredClone(scenes[0]!),
    css: '.vq .drop { animation: fall 1s linear infinite; } @keyframes fall { from { transform: translateY(0) } to { transform: translateY(8px) } }',
    layers: {
      ...structuredClone(scenes[0]!.layers),
      main: {
        tag: 'svg',
        props: {},
        children: [{ tag: 'g', props: { transform: 'translate(300 0)' }, children }],
      },
    },
  });
  const parts = (art: HeaderSceneArt) =>
    spritePlans(art).filter((plan) => plan.layer === 'main' && plan.kind === 'part');
  // Side by side they are one picture.
  expect(parts(scene([...speck(0), ...speck(4), ...speck(20)]))).toHaveLength(1);
  // A rock drawn between two of them keeps its place: the later speck is its own picture,
  // above the rock, and only the earlier one is covered by it.
  const split = parts(scene([...speck(0), ...speck(4, rock), ...speck(8)]));
  expect(split).toHaveLength(2);
  expect(split[0]!.after).toContain('#555555');
  expect(split[1]!.after).toBeUndefined();
});
