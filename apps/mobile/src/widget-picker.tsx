import { useEffect } from 'react';
import { AppState, View, Pressable } from 'react-native';
import { controller } from './runtime';
import { useMobileSnapshot, sameSelection } from './ui/use-mobile-snapshot';
import { Copy, Button } from './ui/primitives';
import { BottomSheet } from './ui/compact/sheet';

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
        {state.groups
          .filter((g) => !g.isArchived)
          .map((group) => (
            <Pressable
              key={group.id}
              accessibilityRole="button"
              accessibilityLabel={group.name}
              onPress={() => void controller.chooseWidgetGroup(group.id)}
              style={{ paddingVertical: 18 }}
            >
              <Copy>{group.name}</Copy>
            </Pressable>
          ))}
        {!state.groups.some((g) => !g.isArchived) ? (
          <>
            <Copy>No Groups yet</Copy>
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
