import { headerSceneMotionAvailable } from '../config';
import { tiltSupported } from '../data/header-tilt';
import {
  ClassicGroupHeader,
  HeaderScenePlaceholder,
  PREVIEW_HEIGHT,
  THUMBNAIL_PICTURE_HEIGHT,
} from './header-scene-card';
import { SEPARATOR } from '@splitbook/shared/separator';
import { lazy, Suspense, type ReactNode } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  HEADER_SCENES,
  HEADER_TIMES,
  headerTimeOfDay,
  type GroupHeader as Header,
} from '@splitbook/shared/group-header';
import type { MobileGroup } from '../data/types';
import { headerChanged, type HeaderSettings as Settings } from '../data/header-settings';
import {
  Card,
  CompactButton,
  CompactText,
  Divider,
  ListRow,
  SectionHeader,
  SegmentedControl,
  TopBar,
  radius,
  useLargeText,
} from './compact';
import { NotAvailableOffline } from './offline-notice';
import { Icon } from './primitives';
import { useTheme } from './theme';
import { usePhoneNow } from './phone-now';
const Scene = lazy(() => import('./header-scene'));
// Screen height, in dp at the member's text size, below which a pinned preview crowds the choices.
const PIN_MIN_ROOM = 600;
const Thumbnail = lazy(() => import('./header-scene-thumbnail'));
/** The day sky behind each scene card's island, as the board draws it. */
const THUMBNAIL_SKY = ['#bcd6ea', '#e6eff5'] as const;
/** Each fixed time's sky, as the disc on its tile. */
const TIME_SKY = {
  morning: ['#a9cdea', '#ffd9ae'],
  day: ['#6fb6ee', '#cfe8fa'],
  sunset: ['#7a5ea8', '#f39a63'],
  night: ['#131a3a', '#34427e'],
} as const;
/** Pairs, in order: the scene cards' two columns, and the time tiles' rows at large text. */
const inRows = <T,>(items: readonly T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, row) =>
    items.slice(row * size, row * size + size),
  );
const named = (time: string) => time[0].toUpperCase() + time.slice(1);
/** The preview's caption: the scene and its time, "now" when Auto follows the clock. */
export function previewCaption(header: Header, hour: number) {
  if (header.style === 'classic') return 'Classic';
  const scene = HEADER_SCENES.find((choice) => choice.id === header.scene)?.name;
  const time =
    header.time === 'auto' ? `now, ${headerTimeOfDay('auto', hour)}` : named(header.time);
  return `${scene}${SEPARATOR}${time}`;
}
/** The hour on this phone, drawn again as it moves while the page shows (#1302). */
const useHour = () => usePhoneNow().hour;
export function HeaderSettings({
  state,
  group,
  offline,
  motion,
  motionMessage,
  tilt,
  tiltMessage,
  onTilt,
  onMotion,
  onChoose,
  onSave,
  onRetry,
  onClose,
}: {
  state: Settings;
  group: MobileGroup;
  offline: boolean;
  motion: boolean;
  motionMessage: string | null;
  tilt: boolean;
  tiltMessage: string | null;
  onTilt: (value: boolean) => void;
  onMotion: (value: boolean) => void;
  onChoose: (change: Partial<Header>) => void;
  onSave: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { fontScale, height } = useWindowDimensions();
  const hour = useHour();
  // The preview stays in view while the choices scroll, unless large text or a short screen
  // would leave the choices too little room; then it scrolls with them.
  const pinned = height / fontScale >= PIN_MIN_ROOM;
  // At 130% text and more the four time tiles go two to a row, each its disc beside its word.
  const large = useLargeText();
  const saving = state.status === 'saving';
  const dimmed = state.draft.style === 'classic';
  // Scene and Time of day only apply to a scene: with Classic chosen they are greyed and kept
  // from being pressed.
  const off = dimmed || saving;
  const tilting = tiltSupported(Platform);
  /** A chosen card, row or tile: the brand's line, doubled inside it, on the brand's tint. */
  const chosenLine = (selected: boolean, corner: number) =>
    selected ? (
      <View
        pointerEvents="none"
        style={{
          ...StyleSheet.absoluteFill,
          borderRadius: corner - 1,
          borderWidth: 1,
          borderColor: theme.brand.main,
        }}
      />
    ) : null;
  const box = (selected: boolean, corner: number) => ({
    borderRadius: corner,
    borderWidth: 1,
    borderColor: selected ? theme.brand.main : theme.borderStrong,
    backgroundColor: selected ? theme.brand.bg : theme.surface,
  });
  const section = (title: string, body: ReactNode, faded = false) => (
    <View style={{ gap: 6, opacity: faded ? 0.45 : 1 }}>
      <SectionHeader title={title} />
      {body}
    </View>
  );
  const preview = (
    <Card>
      {state.draft.style === 'scene' ? (
        <Suspense fallback={<HeaderScenePlaceholder group={group} preview={state.draft} />}>
          <Scene group={group} header={state.draft} motion={motion} tilt={tilt} preview />
        </Suspense>
      ) : (
        <View
          style={{
            height: PREVIEW_HEIGHT,
            justifyContent: 'center',
            paddingHorizontal: 14,
            backgroundColor: theme.surfaceMuted,
          }}
        >
          <ClassicGroupHeader group={group} />
        </View>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingTop: 8,
          paddingBottom: 10,
          paddingHorizontal: 14,
        }}
      >
        <CompactText variant="overline" tone="secondary">
          Preview
        </CompactText>
        <CompactText
          variant="caption"
          tone="secondary"
          accessibilityLiveRegion="polite"
          style={{ flexShrink: 1, textAlign: 'right' }}
        >
          {previewCaption(state.draft, hour)}
        </CompactText>
      </View>
    </Card>
  );
  const sceneCard = (scene: (typeof HEADER_SCENES)[number]) => {
    const selected = state.draft.scene === scene.id;
    return (
      <Pressable
        key={scene.id}
        accessibilityRole="radio"
        accessibilityLabel={scene.name}
        accessibilityState={{ checked: selected, disabled: off }}
        disabled={off}
        onPress={() => onChoose({ scene: scene.id })}
        style={{ flex: 1, minWidth: 0, overflow: 'hidden', ...box(selected, radius.card) }}
      >
        <View style={{ height: THUMBNAIL_PICTURE_HEIGHT, overflow: 'hidden' }}>
          <LinearGradient colors={THUMBNAIL_SKY} style={StyleSheet.absoluteFill} />
          <Suspense fallback={null}>
            <Thumbnail scene={scene.id} />
          </Suspense>
          {selected ? (
            <View
              style={{
                position: 'absolute',
                right: 8,
                top: 8,
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.brand.main,
              }}
            >
              <Icon name="checkmark" size={16} color={theme.brand.contrastText} />
            </View>
          ) : null}
        </View>
        <View
          style={{
            minHeight: 44,
            justifyContent: 'center',
            paddingVertical: 6,
            paddingHorizontal: 12,
          }}
        >
          <CompactText
            weight={selected ? 'semibold' : 'medium'}
            tone={selected ? 'brand' : 'primary'}
            style={{ fontSize: 14, lineHeight: 18 }}
          >
            {scene.name}
          </CompactText>
        </View>
        {chosenLine(selected, radius.card)}
      </Pressable>
    );
  };
  const autoChosen = state.draft.time === 'auto';
  const autoLine = `Follows your clock${SEPARATOR}${headerTimeOfDay('auto', hour)} now`;
  const fixedTimes = HEADER_TIMES.filter(
    (time): time is Exclude<Header['time'], 'auto'> => time !== 'auto',
  );
  const timeTile = (time: (typeof fixedTimes)[number]) => {
    const selected = state.draft.time === time;
    return (
      <Pressable
        key={time}
        accessibilityRole="radio"
        accessibilityLabel={named(time)}
        accessibilityState={{ checked: selected, disabled: off }}
        disabled={off}
        onPress={() => onChoose({ time })}
        style={{
          flex: 1,
          minWidth: 0,
          alignItems: 'center',
          paddingVertical: 8,
          ...(large
            ? { flexDirection: 'row', gap: 10, minHeight: 52, paddingHorizontal: 12 }
            : { justifyContent: 'center', gap: 6, minHeight: 68, paddingHorizontal: 4 }),
          ...box(selected, radius.tile),
        }}
      >
        <View style={{ width: 22, height: 22, borderRadius: 11, overflow: 'hidden' }}>
          <LinearGradient colors={TIME_SKY[time]} style={StyleSheet.absoluteFill} />
          <View
            style={{
              ...StyleSheet.absoluteFill,
              borderRadius: 11,
              borderWidth: 1,
              borderColor: 'rgba(21, 24, 40, 0.18)',
            }}
          />
        </View>
        <CompactText
          weight={selected ? 'semibold' : 'medium'}
          tone={selected ? 'brand' : 'primary'}
          style={{ fontSize: 13, lineHeight: 16, flexShrink: 1 }}
        >
          {named(time)}
        </CompactText>
        {chosenLine(selected, radius.tile)}
      </Pressable>
    );
  };
  return (
    <Modal visible onRequestClose={onClose} animationType="none">
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <TopBar
          title="Header scene"
          subtitle={group.name}
          leading={{ kind: 'back', label: 'Back to Group', onPress: onClose }}
        />
        {pinned && (
          <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 }}>{preview}</View>
        )}
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: pinned ? 0 : 4,
            paddingBottom: 16,
            gap: 12,
          }}
        >
          {!pinned && preview}
          {section(
            'Header',
            <SegmentedControl
              label="Header style"
              value={state.draft.style}
              disabled={saving}
              onChange={(style) => onChoose({ style })}
              options={[
                { value: 'scene', label: 'Scene' },
                { value: 'classic', label: 'Classic' },
              ]}
            />,
          )}
          {section(
            'Scene',
            <View accessibilityRole="radiogroup" accessibilityLabel="Scene" style={{ gap: 8 }}>
              {inRows(HEADER_SCENES, 2).map((row) => (
                <View key={row[0].id} style={{ flexDirection: 'row', gap: 8 }}>
                  {row.map(sceneCard)}
                </View>
              ))}
            </View>,
            dimmed,
          )}
          {section(
            'Time of day',
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Time of day"
              style={{ gap: 8 }}
            >
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={`Auto, ${autoLine}`}
                accessibilityState={{ checked: autoChosen, disabled: off }}
                disabled={off}
                onPress={() => onChoose({ time: 'auto' })}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  minHeight: 56,
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  ...box(autoChosen, radius.tile),
                }}
              >
                <Icon
                  name="time-outline"
                  size={24}
                  color={autoChosen ? theme.brand.main : theme.textSecondary}
                />
                <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <CompactText weight="semibold" tone={autoChosen ? 'brand' : 'primary'}>
                    Auto
                  </CompactText>
                  <CompactText variant="caption" tone="secondary">
                    {autoLine}
                  </CompactText>
                </View>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: autoChosen ? 6 : 2,
                    borderColor: autoChosen ? theme.brand.main : theme.borderStrong,
                  }}
                />
                {chosenLine(autoChosen, radius.tile)}
              </Pressable>
              {inRows(fixedTimes, large ? 2 : 4).map((row) => (
                <View key={row[0]} style={{ flexDirection: 'row', gap: 8 }}>
                  {row.map(timeTile)}
                </View>
              ))}
            </View>,
            dimmed,
          )}
          {headerSceneMotionAvailable &&
            section(
              'On this phone',
              <Card>
                <ListRow
                  title="Motion"
                  titleLines={0}
                  meta="Clouds, water and people move"
                  metaLines={0}
                  trailingSwitch={{ value: motion, onChange: onMotion }}
                />
                {tilting ? (
                  <>
                    <Divider />
                    <ListRow
                      title="Tilt with the phone"
                      titleLines={0}
                      meta="The scene shifts a little as you move the phone"
                      metaLines={0}
                      trailingSwitch={{ value: tilt, onChange: onTilt }}
                    />
                  </>
                ) : null}
              </Card>,
            )}
          <CompactText variant="caption" tone="secondary" style={{ paddingHorizontal: 2 }}>
            {`Everyone in ${group.name} sees the header, scene and time you save. ${
              tilting ? 'Motion and tilt are' : 'Motion is'
            } kept on this phone only.`}
          </CompactText>
          {headerSceneMotionAvailable && motionMessage ? (
            <CompactText accessibilityRole="alert">{motionMessage}</CompactText>
          ) : null}
          {headerSceneMotionAvailable && tiltMessage ? (
            <CompactText accessibilityRole="alert">{tiltMessage}</CompactText>
          ) : null}
          {offline ? (
            <NotAvailableOffline
              message="Changing the header needs a connection. Your choices have not been saved."
              onRetry={onRetry}
            />
          ) : null}
          {state.message ? (
            <CompactText accessibilityRole="alert">{state.message}</CompactText>
          ) : null}
        </ScrollView>
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 14,
            borderTopWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.bgElevated,
          }}
        >
          <CompactButton
            block
            label={saving ? 'Saving…' : 'Save'}
            disabled={offline || !headerChanged(state) || saving}
            onPress={onSave}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
