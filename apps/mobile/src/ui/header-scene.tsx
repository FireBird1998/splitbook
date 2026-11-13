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
import { headerCard, headerTimeOfDay, type GroupHeader } from '@splitbook/shared/group-header';
import type { HeaderSceneArt, SceneVector } from '@splitbook/shared/header-scene-art';
import type { MobileGroup } from '../data/types';
import { CompactText } from './compact';
import { useSceneFloat } from './compact/motion';
import { useTheme, fonts } from './theme';

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

export function HeaderSceneCard({ group, today }: { group: MobileGroup; today: string }) {
  const theme = useTheme();
  const facts = headerCard(group, today);
  return (
    <View style={{ padding: 14, gap: 10, backgroundColor: theme.surface }}>
      {facts.trip ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <CompactText variant="title" style={{ fontFamily: fonts.mono }}>
            {facts.trip.route.from}
          </CompactText>
          <View style={{ flex: 1, borderTopWidth: 1, borderColor: theme.border }} />
          <CompactText>✈</CompactText>
          <View style={{ flex: 1, borderTopWidth: 1, borderColor: theme.border }} />
          <CompactText variant="title" style={{ fontFamily: fonts.mono }}>
            {facts.trip.route.to}
          </CompactText>
        </View>
      ) : (
        <>
          <CompactText variant="title">{facts.name}</CompactText>
          <CompactText tone="secondary">{facts.theme}</CompactText>
        </>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
        {[
          [
            'Dates',
            facts.trip ? [facts.trip.start, facts.trip.end].filter(Boolean).join(' – ') : null,
          ],
          ['Members', String(facts.members)],
          ['Currency', facts.currencies.join(' · ')],
        ].map(([label, value]) =>
          value ? (
            <View key={label} style={{ gap: 2, flexShrink: 1 }}>
              <CompactText variant="small" tone="secondary">
                {label}
              </CompactText>
              <CompactText>{value}</CompactText>
            </View>
          ) : null,
        )}
      </View>
      {facts.trip && facts.trip.days.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {facts.trip.days.map((day, index) => (
            <View
              key={day}
              accessible
              accessibilityLabel={`Trip day ${index + 1}${facts.trip!.today === index + 1 ? ', today' : ''}`}
              style={{ alignItems: 'center', gap: 3 }}
            >
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor:
                    facts.trip!.today === index + 1
                      ? '#ffd27a'
                      : facts.trip!.today !== null && index + 1 < facts.trip!.today
                        ? '#bfa98a'
                        : 'transparent',
                }}
              />
              <CompactText variant="small">{index + 1}</CompactText>
            </View>
          ))}
          <CompactText variant="small" tone="secondary">
            {facts.trip.today
              ? `Day ${facts.trip.today} of ${facts.trip.days.length}`
              : `${facts.trip.days.length} trip days`}
          </CompactText>
        </View>
      ) : null}
    </View>
  );
}
export default function HeaderScene({
  group,
  header,
  motion = true,
  today = new Date().toLocaleDateString('en-CA'),
}: {
  group: MobileGroup;
  header: GroupHeader;
  motion?: boolean;
  today?: string;
}) {
  const [art, setArt] = useState<HeaderSceneArt | null>(null);
  const [hour, setHour] = useState(() => new Date().getHours());
  const translateY = useSceneFloat(motion);
  useEffect(() => {
    let active = true;
    loaders[header.scene]().then((value) => {
      if (active) setArt(value.default);
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
  const time = headerTimeOfDay(header.time, hour);
  return (
    <View style={{ borderRadius: 16, overflow: 'hidden' }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={art?.id === header.scene ? art.description : 'Loading Header scene'}
        style={{ height: 208, overflow: 'hidden' }}
      >
        <LinearGradient colors={sky[time]} style={StyleSheet.absoluteFill} />
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
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, { transform: [{ translateY }] }]}
        >
          {art?.id === header.scene ? <Art art={art} time={time} /> : null}
        </Animated.View>
        <View
          style={{
            position: 'absolute',
            left: 10,
            top: 10,
            backgroundColor: '#ffffffdd',
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 13,
          }}
        >
          <CompactText style={{ color: '#151828' }}>
            {header.time === 'auto' ? `Auto · ${time}` : time}
          </CompactText>
        </View>
      </View>
      <HeaderSceneCard group={group} today={today} />
    </View>
  );
}
