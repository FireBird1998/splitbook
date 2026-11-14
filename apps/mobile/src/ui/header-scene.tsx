import { SceneVisibility } from './scene-visibility';
import { useHeaderTilt } from './use-header-tilt';
import { memo, useContext, useEffect, useState } from 'react';
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
  useSceneRise,
} from './header-scene-motion';
import type { HeaderSceneSprites, SceneSprite } from './header-scene-sprite';
import { headerSceneMotionAvailable } from '../config';
import { currentDayKey } from './list-day-header';
import {
  HeaderSceneCard,
  HeaderScenePreviewCaption,
  HeaderScenePlaceholder,
  ClassicGroupHeader,
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
const lift = (rise: Animated.Value) =>
  rise.interpolate({ inputRange: [0, 1], outputRange: [0, -FLOAT_RISE * SCENE_UNIT] });

const Piece = memo(function Piece({
  sprite,
  rises,
  moving,
  frameWidth,
}: {
  sprite: SceneSprite;
  rises: Rises;
  moving: boolean;
  frameWidth: number;
}) {
  const drift = useCloudDrift(moving && sprite.kind === 'cloud', sprite, frameWidth);
  const rise = rises[sprite.seconds as 7 | 9 | 11] ?? rises[7];
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
                opacity: rise.interpolate({ inputRange: [0, 1], outputRange: [1, 0.8] }),
                transform: [
                  { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }) },
                ],
              }
            : { transform: [{ translateY: lift(rise) }] },
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
  today = currentDayKey(),
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
  const [, setHour] = useState(() => new Date().getHours());
  const visibility = useContext(SceneVisibility);
  const foreground = useForeground();
  // Nothing moves, and no sensor is read, until this scene's pictures are the ones on screen.
  const moving =
    motion &&
    headerSceneMotionAvailable &&
    visible &&
    visibility.visible &&
    foreground &&
    !preview &&
    art?.id === header.scene;
  const position = useHeaderTilt(moving && tilt);
  const frameWidth = useWindowDimensions().width;
  const rise7 = useSceneRise(moving, 7);
  const rise9 = useSceneRise(moving, 9);
  const rise11 = useSceneRise(moving, 11);
  const [rises] = useState<Rises>(() => ({ 7: rise7, 9: rise9, 11: rise11 }));
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
      if (state === 'active') setHour(new Date().getHours());
    });
    return () => sub.remove();
  }, []);
  const time = headerTimeOfDay(header.time, new Date().getHours());
  if (failed === header.scene) return <ClassicGroupHeader group={group} />;
  if (art?.id !== header.scene)
    return (
      <HeaderScenePlaceholder
        group={group}
        header={header}
        preview={preview ? header : undefined}
      />
    );
  return (
    <View
      onLayout={preview ? undefined : visibility.onLayout}
      style={{ borderRadius: 16, overflow: 'hidden' }}
    >
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={art.description}
        style={{ height: 208, overflow: 'hidden' }}
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
          {(['far', 'clouds', 'main', 'front'] as const).map((layer) => (
            <Animated.View key={layer} style={[styles.world, shifts[layer]]}>
              {art.sprites.map((sprite) =>
                sprite.layer === layer ? (
                  <Piece
                    key={`${sprite.kind}:${sprite.x}:${sprite.y}`}
                    sprite={sprite}
                    rises={rises}
                    moving={moving}
                    frameWidth={frameWidth}
                  />
                ) : null,
              )}
            </Animated.View>
          ))}
          {tint[time] ? (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, tint[time]]} />
          ) : null}
          {glow[time] ? (
            <Animated.View style={[styles.world, shifts.glow, { opacity: glow[time] }]}>
              {art.sprites.map((sprite) =>
                sprite.layer === 'glow' ? (
                  <Piece
                    key={`glow:${sprite.x}:${sprite.y}`}
                    sprite={sprite}
                    rises={rises}
                    moving={moving}
                    frameWidth={frameWidth}
                  />
                ) : null,
              )}
            </Animated.View>
          ) : null}
        </View>
      </View>
      {preview ? (
        <HeaderScenePreviewCaption scene={header.scene} time={time} />
      ) : (
        <HeaderSceneCard group={group} today={today} time={time} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // A zero-width column down the middle of the picture: pieces are placed left and right of it,
  // so a wider screen shows more of the scene instead of cropping its top and bottom.
  world: { position: 'absolute', left: '50%', top: 0, width: 0, height: 208 },
});
