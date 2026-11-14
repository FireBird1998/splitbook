import { createElement, memo, useEffect, useState, type ComponentType } from 'react';
import { Animated, AppState, StyleSheet, View } from 'react-native';
import Svg, {
  G,
  Path,
  Polygon,
  Circle,
  Ellipse,
  Rect,
  Defs,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { headerTimeOfDay, type GroupHeader } from '@splitbook/shared/group-header';
import type { HeaderSceneArt, SceneVector } from '@splitbook/shared/header-scene-art';
import type { MobileGroup } from '../data/types';
import { useSceneFloat } from './compact/motion';
import { headerSceneMotionAvailable } from '../config';
import { currentDayKey } from './list-day-header';
import { HeaderSceneCard, HeaderScenePlaceholder, ClassicGroupHeader } from './header-scene-card';
export { HeaderSceneCard } from './header-scene-card';

const loaders = {
  beach: () => import('@splitbook/shared/header-scenes/beach'),
  sakura: () => import('@splitbook/shared/header-scenes/sakura'),
  'eco-city': () => import('@splitbook/shared/header-scenes/eco-city'),
  'mountain-village': () => import('@splitbook/shared/header-scenes/mountain-village'),
};
const primitives = {
  svg: G,
  g: G,
  path: Path,
  polygon: Polygon,
  circle: Circle,
  ellipse: Ellipse,
  rect: Rect,
  defs: Defs,
  radialGradient: RadialGradient,
  stop: Stop,
};
function vector(node: SceneVector, key: number | string): React.ReactNode {
  return createElement(
    primitives[node.tag] as ComponentType<Record<string, string>>,
    { ...node.props, key: String(key) },
    node.children?.map((child, index) => vector(child, index)),
  );
}
// The path tree is built once per scene/time, never once per animation frame or scroll event.
const Art = memo(function Art({
  art,
  time,
}: {
  art: HeaderSceneArt;
  time: ReturnType<typeof headerTimeOfDay>;
}) {
  return (
    <Svg width="100%" height="100%" viewBox="70 0 460 240" preserveAspectRatio="xMidYMid slice">
      {(['far', 'clouds', 'main', 'front'] as const).map((layer) =>
        vector(art.layers[layer], layer),
      )}
      <Rect
        x="0"
        y="0"
        width="1100"
        height="240"
        fill={time === 'night' ? '#28386e' : time === 'sunset' ? '#faaa8c' : '#ffd6ba'}
        opacity={time === 'night' ? 0.52 : time === 'sunset' ? 0.22 : time === 'morning' ? 0.12 : 0}
      />
      <G opacity={time === 'night' ? 0.92 : time === 'sunset' ? 0.55 : 0}>
        {vector(art.layers.glow, 'glow')}
      </G>
    </Svg>
  );
});
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
  today = currentDayKey(),
}: {
  group: MobileGroup;
  header: GroupHeader;
  motion?: boolean;
  today?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [art, setArt] = useState<HeaderSceneArt | null>(null);
  const [, setHour] = useState(() => new Date().getHours());
  const translateY = useSceneFloat(motion && headerSceneMotionAvailable);
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
  if (art?.id !== header.scene) return <HeaderScenePlaceholder group={group} header={header} />;
  return (
    <View style={{ borderRadius: 16, overflow: 'hidden' }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={art?.id === header.scene ? art.description : 'Loading Header scene'}
        style={{ height: 208, overflow: 'hidden' }}
      >
        <LinearGradient colors={sky[time]} style={StyleSheet.absoluteFill} />
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
        <Animated.View
          renderToHardwareTextureAndroid
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, { transform: [{ translateY }] }]}
        >
          {art?.id === header.scene ? <Art art={art} time={time} /> : null}
        </Animated.View>
      </View>
      <HeaderSceneCard group={group} today={today} time={time} />
    </View>
  );
}
