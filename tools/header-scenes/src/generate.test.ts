import { expect, it } from 'vitest';
import { sceneThumbnails } from '../../../packages/shared/src/header-scenes/thumbnails';
import { buildScenes, generatedFiles, staleOutputs, thumbnailSource } from './generate';
import { vectorTree, vectorSvg } from './vectors';
import type { SceneVector } from '@splitbook/shared/header-scene-art';

it('ships all four scenes with portable layers and independent motion and night-light groups', () => {
  const scenes = buildScenes();
  expect(scenes.map(({ name }) => name)).toEqual([
    'Eco city',
    'Mountain village',
    'Beach',
    'Sakura',
  ]);
  const motions = (node: SceneVector): string[] => [
    ...(node.motion ? [node.motion] : []),
    ...(node.children ?? []).flatMap(motions),
  ];
  for (const scene of scenes) {
    expect(Object.keys(scene.layers)).toEqual(['far', 'clouds', 'main', 'front', 'glow']);
    const all = Object.values(scene.layers).flatMap(motions);
    for (const group of ['sway', 'water', 'people', 'clouds', 'windows', 'lanterns'])
      expect(all).toContain(group);
    expect(scene.description).toMatch(/^A floating/);
    expect(scene.viewBox).toEqual([0, 0, 1100, 240]);
  }
  expect(Object.values(scenes[0].layers).flatMap(motions)).toContain('turbines');
  expect(Object.values(scenes[1].layers).flatMap(motions)).toEqual(
    expect.arrayContaining(['smoke', 'snow']),
  );
});
it('detects changed, missing and obsolete output', () => {
  expect(
    staleOutputs(
      new Map([
        ['same', 'ok'],
        ['changed', 'new'],
        ['missing', 'file'],
      ]),
      new Map([
        ['same', 'ok'],
        ['changed', 'old'],
        ['obsolete', 'file'],
      ]),
    ),
  ).toEqual(['changed', 'missing', 'obsolete']);
});
it('keeps nested transforms, delays and native SVG property names through a portable round trip', () => {
  const svg =
    '<svg viewBox="0 0 10 10"><g class="sway" transform="translate(2 3)" style="animation-delay: -2s"><circle fill-opacity="0.5" cx="1" cy="2" r="3"></circle></g></svg>';
  const tree = vectorTree(svg);
  expect(tree.children?.[0]).toMatchObject({
    motion: 'sway',
    delaySeconds: -2,
    props: { transform: 'translate(2 3)' },
    children: [{ tag: 'circle', props: { fillOpacity: '0.5' } }],
  });
  expect(vectorTree(vectorSvg(tree))).toEqual(tree);
});
it.each([
  '<svg><script></script></svg>',
  '<svg><path onclick="bad()"></path></svg>',
  '<svg><g></svg>',
  '<svg>text</svg>',
])('refuses unsupported vector input', (svg) => {
  expect(() => vectorTree(svg)).toThrow();
});

it.each([
  ['beach', ['boat', 'animals', 'birds']],
  ['sakura', ['animals', 'petals']],
] as const)(
  '%s retains its characteristic moving details separately from the night lights',
  (id, expected) => {
    const scene = buildScenes().find((scene) => scene.id === id)!;
    const nodes = (node: SceneVector): SceneVector[] => [
      node,
      ...(node.children ?? []).flatMap(nodes),
    ];
    const main = nodes(scene.layers.main);
    const glow = nodes(scene.layers.glow);
    expect(main.map((node) => node.motion)).toEqual(
      expect.arrayContaining([...expected, 'people', 'sway', 'water']),
    );
    expect(glow.map((node) => node.motion)).toEqual(
      expect.arrayContaining(['windows', 'lanterns', 'halo']),
    );
    expect(
      glow
        .filter((node) => node.motion === 'windows' || node.motion === 'lanterns')
        .every((node) => (node.children?.length ?? 0) > 0),
    ).toBe(true);
    expect(main.some((node) => node.motion === 'windows')).toBe(false);
  },
);
it('covers the four scene modules and common styles in a repeatable fresh build', async () => {
  const first = await generatedFiles();
  expect([...first.keys()].sort()).toEqual([
    'beach.ts',
    'eco-city.ts',
    'mountain-village.ts',
    'sakura.ts',
    'styles.ts',
    'thumbnails.ts',
  ]);
  expect(staleOutputs(first, await generatedFiles())).toEqual([]);
});

it('builds a decodable, bounded raster thumbnail for every generated scene', async () => {
  const { default: sharp } = await import('sharp');
  for (const scene of buildScenes()) {
    const uri = sceneThumbnails[scene.id];
    expect(uri).toMatch(/^data:image\/png;base64,/);
    const data = Buffer.from(uri.split(',')[1], 'base64');
    expect(data.byteLength).toBeLessThan(80_000);
    const metadata = await sharp(data).metadata();
    expect([metadata.width, metadata.height]).toEqual([368, 192]);
  }
});

it('checks the raster source stamp across platform-specific PNG bytes', async () => {
  const expected = await generatedFiles(false);
  const actual = new Map(expected);
  actual.set('thumbnails.ts', expected.get('thumbnails.ts')! + '\n// different platform PNG bytes');
  expect(staleOutputs(expected, actual)).toEqual([]);
  actual.set(
    'thumbnails.ts',
    actual.get('thumbnails.ts')!.replace(thumbnailSource(), '0'.repeat(64)),
  );
  expect(staleOutputs(expected, actual)).toEqual(['thumbnails.ts']);
  actual.delete('thumbnails.ts');
  expect(staleOutputs(expected, actual)).toEqual(['thumbnails.ts']);
});
it('changes the raster source stamp when a portable vector changes', () => {
  const scenes = buildScenes();
  const before = thumbnailSource(scenes);
  scenes[0].layers.main.children![0].props.transform = 'translate(1 0)';
  expect(thumbnailSource(scenes)).not.toBe(before);
});
