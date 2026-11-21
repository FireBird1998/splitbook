import { SceneVisibility } from './scene-visibility';
import { useHeaderTilt } from './use-header-tilt';
import { memo, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, AppState, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { headerTimeOfDay, type GroupHeader } from '@splitbook/shared/group-header';
import type { MobileGroup } from '../data/types';
import {
  FLOAT_RISE,
  SCENE_CENTRE,
  SCENE_UNIT,
  TILT_DEPTH,
  useCloudDrift,
  useForeground,
  useSceneClocks,
  riseBetween,
  useSceneRise,
  type SceneMotion,
} from './header-scene-motion';
import type { HeaderSceneSprites, SceneSprite } from './header-scene-sprite';
import { headerSceneMotionAvailable } from '../config';
import { phoneDay, phoneHour } from '../data/phone-clock';
import { useReducedMotion } from './compact/motion';
import {
  HeaderSceneCard,
  HeaderScenePlaceholder,
  ClassicGroupHeader,
  PREVIEW_HEIGHT,
} from './header-scene-card';
export { HeaderSceneCard } from './header-scene-card';

// Each scene is a handful of pictures drawn by tools/header-scenes from the traced art. They are
// moved only by native-driver transforms, so nothing is redrawn while the scene floats or tilts.
const loaders = {
  beach: () => import('./header-scene-sprites/beach'),
  sakura: () => import('./header-scene-sprites/sakura'),
  'eco-city': () => import('./header-scene-sprites/eco-city'),
  'mountain-village': () => import('./header-scene-sprites/mountain-village'),
};
type Rises = Record<7 | 9 | 11, Animated.Value>;
const place = (sprite: SceneSprite) =>
  ({
    position: 'absolute',
    left: (sprite.x - SCENE_CENTRE) * SCENE_UNIT,
    top: sprite.y * SCENE_UNIT,
    width: sprite.w * SCENE_UNIT,
    height: sprite.h * SCENE_UNIT,
  }) as const;
/** The same box, for a picture inside a holder already placed there. */
const fill = (sprite: SceneSprite) =>
  ({
    position: 'absolute',
    left: 0,
    top: 0,
    width: sprite.w * SCENE_UNIT,
    height: sprite.h * SCENE_UNIT,
  }) as const;
const lift = (rise: Animated.Value) => riseBetween(rise, 0, -FLOAT_RISE * SCENE_UNIT);

type Clocks = Map<number, Animated.Value>;
/** A part's own movement as native-driver styles: slides and fades from its tracks' clocks. */
function partMotion(sprite: SceneSprite, clocks: Clocks, night: boolean) {
  const slide: object[] = [];
  const turn: object[] = [];
  // Without a fade of its own a part keeps its resting opacity: one that is hidden at rest and
  // only moves at night stays hidden by day.
  let opacity: Animated.AnimatedNode | number | null = null;
  for (const track of sprite.tracks ?? []) {
    const clock = clocks.get(track.seconds);
    if (!clock || (track.time === 'night' && !night)) continue;
    const read = (curve: { at: number[]; to: number[] }, unit = 1) =>
      clock.interpolate({ inputRange: curve.at, outputRange: curve.to.map((to) => to * unit) });
    if (track.x) slide.push({ translateX: read(track.x, SCENE_UNIT) });
    if (track.y) slide.push({ translateY: read(track.y, SCENE_UNIT) });
    if (track.scale) turn.push({ scale: read(track.scale) });
    if (track.rotate)
      turn.push({
        rotate: clock.interpolate({
          inputRange: track.rotate.at,
          outputRange: track.rotate.to.map((to) => `${to + (sprite.slant?.start ?? 0)}deg`),
        }),
      });
    if (track.opacity)
      opacity =
        opacity === null
          ? read(track.opacity)
          : Animated.multiply(opacity as Animated.Value, read(track.opacity));
  }
  return { slide, turn, opacity: opacity ?? sprite.rest ?? 1 };
}

const Piece = memo(function Piece({
  sprite,
  rises,
  clocks,
  lively,
  drifting,
  night,
  frameWidth,
}: {
  sprite: SceneSprite;
  rises: Rises;
  clocks: Clocks;
  /** Motion is on for this phone: parts wear their movement, whether or not the clocks run. */
  lively: boolean;
  /** The scene's motion for a cloud; a part is always still, so a pause redraws none. */
  drifting: SceneMotion;
  night: boolean;
  frameWidth: number;
}) {
  const drift = useCloudDrift(drifting, sprite, frameWidth);
  const rise = rises[sprite.seconds as 7 | 9 | 11] ?? rises[7];
  const motion = useMemo(
    () => (sprite.kind === 'part' && lively ? partMotion(sprite, clocks, night) : null),
    [sprite, clocks, lively, night],
  );
  const floats = useMemo(
    () => (sprite.still ? [] : [{ translateY: lift(rise) }]),
    [sprite.still, rise],
  );
  if (sprite.kind === 'part') {
    // At rest a part stands where the web's still scene has it; one that only shows while it
    // moves (a falling drop, a snowflake) is not drawn at all.
    if (!motion && sprite.rest === 0) return null;
    const { slant } = sprite;
    const placed = [
      ...floats,
      ...(motion?.slide ?? []),
      ...(slant
        ? [{ rotate: `${slant.turn}deg` }, { scaleX: slant.scaleX }, { scaleY: slant.scaleY }]
        : []),
    ];
    const turned = motion?.turn.length
      ? motion.turn
      : slant
        ? [{ rotate: `${slant.start}deg` }]
        : [];
    const opacity = motion ? motion.opacity : (sprite.rest ?? 1);
    const picture = (
      <Animated.Image
        accessible={false}
        fadeDuration={0}
        resizeMode="stretch"
        source={sprite.image}
        style={
          slant
            ? [fill(sprite), { transform: turned }]
            : [place(sprite), { opacity, transform: [...placed, ...turned] }]
        }
      />
    );
    // A slanted part turns inside a holder that carries the slant, so the turn itself stays round.
    return slant ? (
      <Animated.View style={[place(sprite), { opacity, transform: placed }]}>
        {picture}
      </Animated.View>
    ) : (
      picture
    );
  }
  return (
    <Animated.Image
      accessible={false}
      fadeDuration={0}
      resizeMode="stretch"
      source={sprite.image}
      style={[
        place(sprite),
        sprite.kind === 'cloud'
          ? { transform: [{ translateX: drift }] }
          : sprite.kind === 'shadow'
            ? {
                // The shadow tightens and fades as the island rises away from it.
                opacity: riseBetween(rise, 1, 0.8),
                transform: [{ scale: riseBetween(rise, 1, 0.96) }],
              }
            : { transform: floats },
      ]}
    />
  );
});
const tint = {
  morning: { backgroundColor: '#ffd6ba', opacity: 0.12 },
  day: null,
  sunset: { backgroundColor: '#faaa8c', opacity: 0.22 },
  night: { backgroundColor: '#28386e', opacity: 0.52 },
} as const;
const glow = { morning: 0, day: 0, sunset: 0.55, night: 0.92 } as const;
const GROUP_LAYERS = ['far', 'clouds', 'main', 'front'] as const;
// The settings preview draws the main island alone, as its board does (#1267): the neighbouring
// islands, the clouds and the front rocks would be cut at the card's edges. Beach's small neighbour
// is in the main layer, but it floats on its own period, so the preview keeps only what floats with
// the island.
const PREVIEW_LAYERS = ['main'] as const;
/** Scene units across the settings preview: the board's viewBox, x 70 to 530. */
const PREVIEW_SPAN = 460;
/** The card around the pinned preview: the page's 16 dp sides and the card's 1 dp border. */
const PREVIEW_INSET = 34;
/**
 * The scene's pictures as the settings preview shows them: scaled so the board's span fills the
 * card's width (or its height, if that is larger), with the scene's middle line on the frame's.
 */
const previewWorld = (width: number) =>
  ({
    position: 'absolute',
    left: 0,
    right: 0,
    top: PREVIEW_HEIGHT / 2 - 120 * SCENE_UNIT,
    height: 240 * SCENE_UNIT,
    transform: [{ scale: Math.max(width / PREVIEW_SPAN, PREVIEW_HEIGHT / 240) / SCENE_UNIT }],
  }) as const;
const sky = {
  morning: ['#c8d9ed', '#f9dfc1'],
  day: ['#a9d3ec', '#e5edf4'],
  sunset: ['#8c93be', '#f7c19a'],
  night: ['#101a35', '#344362'],
} as const;

export default function HeaderScene({
  group,
  header,
  motion = true,
  preview = false,
  tilt = true,
  visible = true,
  today = phoneDay(),
}: {
  group: MobileGroup;
  header: GroupHeader;
  motion?: boolean;
  today?: string;
  preview?: boolean;
  tilt?: boolean;
  visible?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [art, setArt] = useState<HeaderSceneSprites | null>(null);
  const [, setHour] = useState(() => phoneHour());
  const window = useWindowDimensions();
  // The preview card's width, measured once laid out; until then, the page's estimate.
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const layers = preview ? PREVIEW_LAYERS : GROUP_LAYERS;
  const visibility = useContext(SceneVisibility);
  const foreground = useForeground();
  const reduced = useReducedMotion();
  // Motion is on for this phone. Parts then wear their movement even while the clocks are
  // paused, so a scene that scrolls back into view carries on from the pose it was paused in
  // (the start of each cycle) instead of jumping there from its resting pose. With Motion off or
  // Remove animations on, parts rest where the web's still scene has them.
  const lively = motion && headerSceneMotionAvailable && !reduced && art?.id === header.scene;
  // Nothing runs, and no sensor is read, unless this scene's pictures are the ones on screen.
  const moving =
    lively &&
    visible &&
    // The settings preview is pinned on its own page, outside any Group scroll.
    (preview || visibility.visible) &&
    foreground;
  const time = headerTimeOfDay(header.time, phoneHour());
  const position = useHeaderTilt(moving && tilt);
  const frameWidth = window.width;
  // A pause holds the float and the clouds where they are, since the scene can still be seen;
  // with Motion off or Remove animations they rest where the still scene has them.
  const sceneMotion: SceneMotion = moving ? 'running' : lively ? 'paused' : 'still';
  const rise7 = useSceneRise(sceneMotion, 7);
  const rise9 = useSceneRise(sceneMotion, 9);
  const rise11 = useSceneRise(sceneMotion, 11);
  const [rises] = useState<Rises>(() => ({ 7: rise7, 9: rise9, 11: rise11 }));
  // The pictures on screen: the glow layer only when its time shows it, and in the preview only
  // the main island and what floats with it.
  const shown = useMemo(() => {
    const sprites = art?.sprites ?? [];
    const island = sprites
      .filter((sprite) => sprite.layer === 'main' && sprite.kind === 'body')
      .sort((a, b) => b.w * b.h - a.w * a.h)[0];
    return new Set(
      sprites.filter((sprite) =>
        sprite.layer === 'glow'
          ? glow[time] > 0
          : (layers as readonly string[]).includes(sprite.layer) &&
            (!preview || sprite.layer !== 'main' || sprite.seconds === island?.seconds),
      ),
    );
  }, [art, time, layers, preview]);
  // One clock per period that something on screen uses: the glow layer and night-only movement
  // start no clock while the scene does not show them.
  const periods = useMemo(
    () =>
      [
        ...new Set(
          [...shown].flatMap((sprite) =>
            (sprite.tracks ?? [])
              .filter((track) => track.time !== 'night' || time === 'night')
              .map((track) => track.seconds),
          ),
        ),
      ].sort((a, b) => a - b),
    [shown, time],
  );
  const clocks = useSceneClocks(moving, periods);
  // One set of animated nodes for the life of the scene, not one per render.
  const [shifts] = useState(
    () =>
      Object.fromEntries(
        Object.entries(TILT_DEPTH).map(([layer, depth]) => [
          layer,
          {
            transform: [
              { translateX: Animated.multiply(position.x, depth) },
              { translateY: Animated.multiply(position.y, depth * 0.6) },
            ],
          },
        ]),
      ) as Record<keyof typeof TILT_DEPTH, object>,
  );
  useEffect(() => {
    let active = true;
    loaders[header.scene]()
      .then((value) => {
        if (active) setArt(value.default);
      })
      .catch(() => {
        if (active) setFailed(header.scene);
      });
    return () => {
      active = false;
    };
  }, [header.scene]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setHour(phoneHour());
    });
    return () => sub.remove();
  }, []);
  if (failed === header.scene) return <ClassicGroupHeader group={group} />;
  if (art?.id !== header.scene)
    return (
      <HeaderScenePlaceholder
        group={group}
        header={header}
        preview={preview ? header : undefined}
      />
    );
  const world = (children: ReactNode) =>
    preview ? (
      <View style={previewWorld(previewWidth ?? window.width - PREVIEW_INSET)}>{children}</View>
    ) : (
      children
    );
  return (
    <View
      onLayout={preview ? undefined : visibility.onLayout}
      // The preview's card rounds and clips it.
      style={preview ? undefined : { borderRadius: 16, overflow: 'hidden' }}
    >
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={art.description}
        onLayout={
          preview ? ({ nativeEvent }) => setPreviewWidth(nativeEvent.layout.width) : undefined
        }
        style={{ height: preview ? PREVIEW_HEIGHT : 208, overflow: 'hidden' }}
      >
        <LinearGradient colors={sky[time]} style={StyleSheet.absoluteFill} />
        <Animated.View style={[StyleSheet.absoluteFill, shifts.sky]}>
          {time === 'night'
            ? [6, 14, 22, 33, 47, 58, 66, 78, 88, 94].map((left, index) => (
                <View
                  key={left}
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    top: 12 + (index % 3) * 12,
                    width: 2,
                    height: 2,
                    backgroundColor: '#e9eefc',
                    borderRadius: 1,
                  }}
                />
              ))
            : null}
          <View
            style={{
              position: 'absolute',
              left: time === 'morning' ? '12%' : '82%',
              top: time === 'sunset' ? '70%' : '18%',
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: time === 'night' ? '#f4f1e6' : '#fff1c9',
            }}
          />
        </Animated.View>
        <View importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
          {world(
            layers.map((layer) => (
              <Animated.View key={layer} style={[styles.world, shifts[layer]]}>
                {art.sprites.map((sprite, index) =>
                  sprite.layer === layer && shown.has(sprite) ? (
                    <Piece
                      key={index}
                      sprite={sprite}
                      rises={rises}
                      clocks={clocks}
                      lively={lively}
                      drifting={sprite.kind === 'cloud' ? sceneMotion : 'still'}
                      night={time === 'night'}
                      frameWidth={frameWidth}
                    />
                  ) : null,
                )}
              </Animated.View>
            )),
          )}
          {tint[time] ? (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, tint[time]]} />
          ) : null}
          {glow[time]
            ? world(
                <Animated.View style={[styles.world, shifts.glow, { opacity: glow[time] }]}>
                  {art.sprites.map((sprite, index) =>
                    sprite.layer === 'glow' ? (
                      <Piece
                        key={index}
                        sprite={sprite}
                        rises={rises}
                        clocks={clocks}
                        lively={lively}
                        drifting={sprite.kind === 'cloud' ? sceneMotion : 'still'}
                        night={time === 'night'}
                        frameWidth={frameWidth}
                      />
                    ) : null,
                  )}
                </Animated.View>,
              )
            : null}
        </View>
      </View>
      {preview ? null : <HeaderSceneCard group={group} today={today} time={time} />}
    </View>
  );
}

const styles = StyleSheet.create({
  // A zero-width column down the middle of the picture: pieces are placed left and right of it,
  // so a wider screen shows more of the scene instead of cropping its top and bottom.
  world: { position: 'absolute', left: '50%', top: 0, width: 0, height: 208 },
});
