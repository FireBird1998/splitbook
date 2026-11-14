import { expect, it } from 'vitest';
import {
  cloudTravel,
  FLOAT_RISE,
  SCENE_CENTRE,
  SCENE_UNIT,
  TILT_DEPTH,
} from './header-scene-motion';
import beach from './header-scene-sprites/beach';
import sakura from './header-scene-sprites/sakura';
import ecoCity from './header-scene-sprites/eco-city';
import mountainVillage from './header-scene-sprites/mountain-village';

const scenes = [beach, sakura, ecoCity, mountainVillage];
const PICTURE_HEIGHT = 208;

it('keeps tilt within a few dp and turns the layers about the main island', () => {
  for (const depth of Object.values(TILT_DEPTH)) expect(Math.abs(depth)).toBeLessThanOrEqual(5);
  expect(TILT_DEPTH.far).toBeLessThan(TILT_DEPTH.clouds);
  expect(TILT_DEPTH.clouds).toBeLessThan(TILT_DEPTH.main);
  expect(TILT_DEPTH.main).toBeLessThan(0);
  expect(TILT_DEPTH.front).toBeGreaterThan(0);
  expect(TILT_DEPTH.glow).toBe(TILT_DEPTH.main);
});

it.each(scenes.map((scene) => [scene.id, scene] as const))(
  '%s has every layer, one shadow under the island, and floats on the three shared periods',
  (_, scene) => {
    for (const layer of ['far', 'clouds', 'main', 'front', 'glow'])
      expect(scene.sprites.some((sprite) => sprite.layer === layer)).toBe(true);
    expect(scene.sprites.filter((sprite) => sprite.kind === 'shadow')).toHaveLength(1);
    for (const sprite of scene.sprites)
      if (sprite.kind !== 'cloud') expect([7, 9, 11]).toContain(sprite.seconds);
    const main = scene.sprites.filter((s) => s.layer === 'main' && s.kind === 'body').at(-1)!;
    expect(main.x).toBeLessThan(SCENE_CENTRE);
    expect(main.x + main.w).toBeGreaterThan(SCENE_CENTRE);
  },
);

it.each(scenes.map((scene) => [scene.id, scene] as const))(
  '%s main island stays inside the picture at the top of its rise and at full tilt',
  (_, scene) => {
    // No moving piece is cut by its own picture, and the sky behind never moves, so an island that
    // stays inside the 208 dp picture cannot uncover a blank strip.
    const travel = FLOAT_RISE * SCENE_UNIT + Math.abs(TILT_DEPTH.main) * 0.6;
    const main = scene.sprites.filter((s) => s.layer === 'main' && s.kind === 'body').at(-1)!;
    expect(main.y * SCENE_UNIT - travel).toBeGreaterThanOrEqual(0);
    expect((main.y + main.h) * SCENE_UNIT + travel).toBeLessThanOrEqual(PICTURE_HEIGHT);
  },
);

it.each([320, 380, 412, 600, 840])(
  'a cloud leaves a %s dp picture fully before it returns, fully hidden, on the other side',
  (frameWidth) => {
    for (const scene of scenes)
      for (const cloud of scene.sprites.filter((sprite) => sprite.kind === 'cloud')) {
        const travel = cloudTravel(cloud, frameWidth);
        const left = (offset: number) => (cloud.x - SCENE_CENTRE) * SCENE_UNIT + offset;
        const tilt = Math.max(...Object.values(TILT_DEPTH).map(Math.abs));
        expect(left(travel.exit)).toBeGreaterThanOrEqual(frameWidth / 2 + tilt);
        expect(left(travel.entry) + cloud.w * SCENE_UNIT).toBeLessThanOrEqual(
          -frameWidth / 2 - tilt,
        );
        expect(travel.start === 0 || travel.start === travel.entry).toBe(true);
        expect(travel.exit).toBeGreaterThan(travel.start);
        // Slow enough to read as weather: between 3 and 10 dp a second.
        expect(travel.dpPerSecond).toBeGreaterThan(3);
        expect(travel.dpPerSecond).toBeLessThan(10);
      }
  },
);
