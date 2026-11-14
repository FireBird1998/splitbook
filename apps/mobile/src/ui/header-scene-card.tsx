import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { SEPARATOR } from '@splitbook/shared/separator';
import {
  HEADER_SCENES,
  headerCard,
  headerCardTone,
  headerTimeOfDay,
  readGroupHeader,
  type GroupHeader,
} from '@splitbook/shared/group-header';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { View } from 'react-native';
import type { MobileGroup } from '../data/types';
import { CompactText } from './compact';
import { currentDayKey } from './list-day-header';
import { TripStrip } from './trip-strip';
import { fonts, ThemeContext, useTheme } from './theme';

export function HeaderSceneCard({
  group,
  today,
  time = 'day',
}: {
  group: MobileGroup;
  today: string;
  time?: ReturnType<typeof headerTimeOfDay>;
}) {
  const appTheme = useTheme();
  const facts = headerCard(group, today, time);
  const theme = facts.tone === 'dark' ? getSemanticTokens('dark') : appTheme;
  return (
    <ThemeContext.Provider value={theme}>
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
            ['Dates', facts.trip?.dateRange ?? null],
            ['Members', String(facts.members)],
            ['Currency', facts.currencies.join(SEPARATOR)],
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
          <View accessible accessibilityLabel={facts.trip.caption ?? undefined}>
            <View
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
            >
              {facts.trip.days.map((day) => (
                <View key={day} style={{ alignItems: 'center', gap: 3 }}>
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      borderWidth: 1,
                      borderColor: theme.border,
                      backgroundColor:
                        day === today ? '#ffd27a' : day < today ? '#bfa98a' : 'transparent',
                    }}
                  />
                  <CompactText variant="small">{Number(day.slice(-2))}</CompactText>
                </View>
              ))}
              <CompactText variant="small" tone="secondary">
                {facts.trip.caption}
              </CompactText>
            </View>
          </View>
        ) : null}
      </View>
    </ThemeContext.Provider>
  );
}
/** Art always reserves its final height, with the actual card below it at every text scale. */
export function HeaderScenePlaceholder({
  group,
  header = readGroupHeader(group.header),
  preview,
}: {
  group: MobileGroup;
  header?: GroupHeader;
  preview?: GroupHeader;
}) {
  const theme = useTheme();
  const time = headerTimeOfDay((preview ?? header).time, new Date().getHours());
  return (
    <View style={{ borderRadius: 16, overflow: 'hidden' }}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Loading Header scene"
        style={{ height: 208, backgroundColor: theme.surfaceMuted }}
      />
      {preview ? (
        <HeaderScenePreviewCaption scene={preview.scene} time={time} />
      ) : (
        <HeaderSceneCard group={group} today={currentDayKey()} time={time} />
      )}
    </View>
  );
}
export function ClassicGroupHeader({ group }: { group: MobileGroup }) {
  return getGroupTheme(group.category).header === 'strip' ? <TripStrip group={group} /> : null;
}

export function HeaderScenePreviewCaption({
  scene,
  time,
}: {
  scene: GroupHeader['scene'];
  time: ReturnType<typeof headerTimeOfDay>;
}) {
  const appTheme = useTheme();
  const theme = headerCardTone(time) === 'dark' ? getSemanticTokens('dark') : appTheme;
  return (
    <ThemeContext.Provider value={theme}>
      <View style={{ padding: 12, backgroundColor: theme.surface }}>
        <CompactText variant="small">
          Preview{SEPARATOR}
          {HEADER_SCENES.find((choice) => choice.id === scene)?.name}
          {SEPARATOR}
          {time}
        </CompactText>
      </View>
    </ThemeContext.Provider>
  );
}
