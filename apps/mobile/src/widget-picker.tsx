import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { controller } from './runtime';
import { useMobileSnapshot, sameSelection } from './ui/use-mobile-snapshot';
import { Copy, Button } from './ui/primitives';
import { BottomSheet } from './ui/compact/sheet';
import { Card, IconTile, ListRow } from './ui/compact';
import { groupThemeIcons } from './ui/group-icon';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { counted, SEPARATOR } from '@splitbook/shared/separator';

export function WidgetGroupPicker() {
  const state = useMobileSnapshot(
    controller,
    (s) => ({ open: !!s.widgetPicker && s.auth.status === 'authenticated', groups: s.groups.data }),
    sameSelection,
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active' && controller.getSnapshot().widgetPicker)
        controller.closeWidgetPicker();
    });
    return () => subscription.remove();
  }, []);
  if (!state.open) return null;
  return (
    <BottomSheet
      visible
      title="Choose a Group"
      onDone={controller.closeWidgetPicker}
      doneLabel="Cancel"
    >
      <View style={{ gap: 12 }}>
        {state.groups.some((g) => !g.isArchived) ? (
          <Card>
            {state.groups
              .filter((g) => !g.isArchived)
              .map((group) => (
                <ListRow
                  key={group.id}
                  leading={<IconTile icon={groupThemeIcons[group.category]} />}
                  title={group.name}
                  meta={`${getGroupTheme(group.category).label}${SEPARATOR}${counted(group.members.length, 'member')}`}
                  accessibilityLabel={group.name}
                  onPress={() => void controller.chooseWidgetGroup(group.id)}
                />
              ))}
          </Card>
        ) : null}
        {!state.groups.some((g) => !g.isArchived) ? (
          <>
            <Copy>Create or join a Group to add an expense.</Copy>
            <Button
              label="Create a Group"
              onPress={() => {
                controller.closeWidgetPicker();
                void controller.openWidget('create-group');
              }}
            />
          </>
        ) : null}
      </View>
    </BottomSheet>
  );
}
