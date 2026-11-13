import { SEPARATOR } from '@splitbook/shared/separator';
import { lazy, Suspense } from 'react';
import { Modal, ScrollView, Switch, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  HEADER_SCENES,
  HEADER_TIMES,
  type GroupHeader as Header,
} from '@splitbook/shared/group-header';
import type { MobileGroup } from '../data/types';
import { headerChanged, type HeaderSettings as Settings } from '../data/header-settings';
import { Card, CompactText, CompactButton, TopBar, SectionHeader } from './compact';
import { GroupHeader } from './group-header';
import { NotAvailableOffline } from './offline-notice';
import { useTheme } from './theme';
const Scene = lazy(() => import('./header-scene'));
export function HeaderSettings({
  state,
  group,
  offline,
  motion,
  motionMessage,
  onMotion,
  onChoose,
  onSave,
  onClose,
}: {
  state: Settings;
  group: MobileGroup;
  offline: boolean;
  motion: boolean;
  motionMessage: string | null;
  onMotion: (value: boolean) => void;
  onChoose: (change: Partial<Header>) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const dimmed = state.draft.style === 'classic';
  const choice = (label: string, selected: boolean, onPress: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled || state.status === 'saving'}
      onPress={onPress}
      style={{
        minHeight: 48,
        minWidth: 48,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: selected ? theme.brand.main : theme.border,
        backgroundColor: selected ? theme.surfaceMuted : theme.surface,
      }}
    >
      <CompactText>{label}</CompactText>
    </Pressable>
  );
  return (
    <Modal visible onRequestClose={onClose} animationType="none">
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <TopBar
          title="Header scene"
          subtitle={group.name}
          leading={{ kind: 'back', label: 'Back to Group', onPress: onClose }}
        />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {state.draft.style === 'scene' ? (
            <Suspense fallback={<CompactText>Loading preview</CompactText>}>
              <Scene group={group} header={state.draft} motion={motion} />
            </Suspense>
          ) : (
            <GroupHeader group={{ ...group, header: state.draft }} motion={motion} />
          )}
          <SectionHeader title="Header" />
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Header style"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
          >
            {choice('Scene', !dimmed, () => onChoose({ style: 'scene' }))}
            {choice('Classic', dimmed, () => onChoose({ style: 'classic' }))}
          </View>
          <View style={{ opacity: dimmed ? 0.45 : 1, gap: 12 }}>
            <SectionHeader title="Scene" />
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Scene"
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
            >
              {HEADER_SCENES.map((scene) =>
                choice(
                  scene.name,
                  state.draft.scene === scene.id,
                  () => onChoose({ scene: scene.id }),
                  dimmed,
                ),
              )}
            </View>
            <SectionHeader title="Time of day" />
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Time of day"
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
            >
              {HEADER_TIMES.map((time) =>
                choice(
                  time === 'auto'
                    ? `Auto${SEPARATOR}follows your clock`
                    : time[0].toUpperCase() + time.slice(1),
                  state.draft.time === time,
                  () => onChoose({ time }),
                  dimmed,
                ),
              )}
            </View>
          </View>
          <SectionHeader title="On this phone" />
          <Card>
            <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <CompactText>Motion</CompactText>
                <CompactText variant="small" tone="secondary">
                  Gentle scene motion. Android’s Remove animations always wins.
                </CompactText>
              </View>
              <Switch
                accessibilityLabel="Motion"
                value={motion}
                onValueChange={onMotion}
                style={{ minWidth: 48, minHeight: 48 }}
              />
            </View>
          </Card>
          {motionMessage ? (
            <CompactText accessibilityRole="alert">{motionMessage}</CompactText>
          ) : null}
          <SectionHeader title="Who sees what" />
          <CompactText variant="small" tone="secondary">
            Everyone in {group.name} sees the header, scene and time you save. Motion is kept on
            this phone only.
          </CompactText>
          {offline ? (
            <NotAvailableOffline
              message="Changing the header needs a connection. Your choices have not been saved."
              onRetry={onSave}
            />
          ) : null}
          {state.message ? (
            <CompactText accessibilityRole="alert">{state.message}</CompactText>
          ) : null}
          <CompactButton
            label={state.status === 'saving' ? 'Saving…' : 'Save'}
            disabled={!headerChanged(state) || state.status === 'saving'}
            onPress={onSave}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
