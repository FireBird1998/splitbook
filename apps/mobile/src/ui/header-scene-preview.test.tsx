import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { expect, it, vi } from 'vitest';
import { HEADER_SCENES } from '@splitbook/shared/group-header';
import HeaderScene from './header-scene';
import HeaderSceneThumbnail, {
  THUMBNAIL_PICTURE_HEIGHT,
  thumbnailIslands,
} from './header-scene-thumbnail';
import { PREVIEW_HEIGHT } from './header-scene-card';
import { SCENE_UNIT } from './header-scene-motion';
import { SceneVisibility } from './scene-visibility';
import beach from './header-scene-sprites/beach';
import sakura from './header-scene-sprites/sakura';
import ecoCity from './header-scene-sprites/eco-city';
import mountainVillage from './header-scene-sprites/mountain-village';
import type { MobileGroup } from '../data/types';

vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const group = {
  name: 'Goa Friends Trip',
  category: 'home',
  members: [],
  defaultCurrency: 'INR',
  alternateCurrencies: [],
} as unknown as MobileGroup;

async function render(preview: boolean) {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(
      <SceneVisibility.Provider value={{ visible: true, onLayout: () => {} }}>
        <HeaderScene
          group={group}
          header={{ style: 'scene', scene: 'beach', time: 'night' }}
          motion={false}
          preview={preview}
        />
      </SceneVisibility.Provider>,
    );
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(picture(view)).toBeDefined();
  });
  return view;
}
const picture = (view: ReturnType<typeof create>) =>
  view.root.findAll(
    (node) => (node.type as unknown) === 'View' && node.props.accessibilityRole === 'image',
  )[0];
const sources = (view: ReturnType<typeof create>) =>
  new Set(
    view.root
      .findAll((node) => (node.type as unknown) === 'AnimatedImage')
      .map((node) => node.props.source),
  );
const imagesOf = (layers: string[]) =>
  new Set(beach.sprites.filter((sprite) => layers.includes(sprite.layer)).map((s) => s.image));

it('the settings preview is the board’s 150 dp picture of the island alone, scaled to fit across', async () => {
  const view = await render(true);
  const frame = picture(view);
  expect(PREVIEW_HEIGHT).toBe(150);
  expect(StyleSheet.flatten(frame.props.style)).toMatchObject({ height: 150, overflow: 'hidden' });
  // Only the main island (with its shadow and lights): no neighbouring islands, clouds or the
  // front rocks, which the board's preview leaves out and the frame would cut at its edges.
  const shown = sources(view);
  expect(shown.size).toBeGreaterThan(0);
  for (const image of shown) expect(imagesOf(['main', 'glow']).has(image)).toBe(true);
  for (const image of imagesOf(['far', 'clouds', 'front'])) expect(shown.has(image)).toBe(false);
  // Beach's small neighbour shares the main layer but floats on its own period: it is left out
  // too, while the island's body, shadow and moving parts (which float with it) stay.
  const neighbour = beach.sprites.filter((s) => s.layer === 'main' && s.seconds !== 7);
  expect(neighbour.length).toBeGreaterThan(0);
  for (const sprite of neighbour) expect(shown.has(sprite.image)).toBe(false);
  for (const kind of ['body', 'shadow'] as const)
    expect(
      beach.sprites.some((s) => s.layer === 'main' && s.kind === kind && shown.has(s.image)),
      kind,
    ).toBe(true);
  // The board's 460 units across the card's width, centred on the island: x 70 to 530.
  act(() => frame.props.onLayout({ nativeEvent: { layout: { width: 378, height: 150 } } }));
  const scaled = frame.findAll(
    (node: ReactTestInstance) =>
      (node.type as unknown) === 'View' &&
      (StyleSheet.flatten(node.props.style)?.transform as { scale?: number }[] | undefined)?.some(
        (step) => step.scale !== undefined,
      ) === true,
  );
  expect(scaled.length).toBeGreaterThan(0);
  for (const node of scaled) {
    const style = StyleSheet.flatten(node.props.style);
    const scale = (style.transform as { scale?: number }[]).find((step) => step.scale)!.scale!;
    expect(scale).toBeCloseTo(378 / 460 / SCENE_UNIT, 5);
    // The scene's middle line (240 units tall, so 120) sits on the frame's middle.
    expect(style.top).toBeCloseTo(75 - 120 * SCENE_UNIT, 5);
    expect(style.height).toBeCloseTo(240 * SCENE_UNIT, 5);
  }
  act(() => view.unmount());
});

it('the Group screen’s scene keeps its 208 dp height and every layer', async () => {
  const view = await render(false);
  expect(StyleSheet.flatten(picture(view).props.style)).toMatchObject({ height: 208 });
  const shown = sources(view);
  expect([...imagesOf(['far'])].some((image) => shown.has(image))).toBe(true);
  act(() => view.unmount());
});

it.each([[beach], [sakura], [ecoCity], [mountainVillage]])(
  'the $id thumbnail is its main island where the board’s card draws it',
  (art) => {
    // The island is the main layer's largest picture (Beach's small neighbour is a picture of its
    // own), which is what the thumbnail draws.
    const island = art.sprites
      .filter((sprite) => sprite.layer === 'main' && sprite.kind === 'body')
      .sort((a, b) => b.w * b.h - a.w * a.h)[0];
    expect(thumbnailIslands[art.id]).toEqual({
      x: island.x,
      y: island.y,
      w: island.w,
      h: island.h,
    });
  },
);

it('a thumbnail draws its island at the board’s scale: 240 units to the 84 dp picture', () => {
  expect(THUMBNAIL_PICTURE_HEIGHT).toBe(84);
  for (const { id } of HEADER_SCENES) {
    let view!: ReturnType<typeof create>;
    act(() => {
      view = create(<HeaderSceneThumbnail scene={id} />);
    });
    const image = view.root.find((node) => (node.type as unknown) === 'Image');
    const box = thumbnailIslands[id];
    const scale = 84 / 240;
    expect(StyleSheet.flatten(image.props.style)).toMatchObject({
      position: 'absolute',
      top: box.y * scale,
      width: box.w * scale,
      height: box.h * scale,
      // Centred on the scene's middle, x 300, as the board's viewBox 150 to 450 is.
      left: '50%',
      marginLeft: (box.x - 300) * scale,
    });
    act(() => view.unmount());
  }
});
