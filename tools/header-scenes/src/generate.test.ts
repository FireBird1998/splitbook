import { expect, it } from 'vitest';
import { buildScenes, staleOutputs } from './generate';
import { vectorTree, vectorSvg } from './vectors';
import type { SceneVector } from '@splitbook/shared/header-scene-art';

it('ships both scenes with portable layers and independent motion and night-light groups', () => {
  const scenes = buildScenes();
  expect(scenes.map(({ name }) => name)).toEqual(['Eco city', 'Mountain village']);
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
