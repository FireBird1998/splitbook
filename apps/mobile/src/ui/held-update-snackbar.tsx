import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { MobileController } from '../data/mobile-controller';
import type { HeldNotificationOwner } from '../data/types';
import { Snackbar } from './compact/feedback';
import { useDismissAfter } from './group-snackbar';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';

function HeldNotice({
  notice,
  bottom,
  onDismiss,
  widget,
  inline,
}: {
  notice: HeldNotificationOwner;
  bottom: number;
  onDismiss(): void;
  widget: boolean;
  inline?: boolean;
}) {
  useDismissAfter(notice, 4_000, onDismiss);
  return (
    <Snackbar
      message={widget ? 'Widget held until you finish' : 'Update held until you finish'}
      bottom={bottom}
      inline={inline}
    />
  );
}

/** Feedback floats above the measured task bar without changing the form's scroll geometry. */
export function HeldUpdateFooter({
  controller,
  children,
  inline,
}: {
  controller: MobileController;
  children?: ReactNode;
  inline?: boolean;
}) {
  const state = useMobileSnapshot(
    controller,
    (s) => ({
      owner: s.heldNotification,
      notice: s.heldNotificationNotice,
      widget: s.heldNotificationSource === 'widget',
    }),
    sameSelection,
  );
  const [shown, setShown] = useState<HeldNotificationOwner | null>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!state.notice) return;
    setShown(state.notice);
    controller.consumeHeldNotificationNotice(state.notice);
  }, [controller, state.notice]);
  return (
    <View onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
      {!inline && children}
      {shown && shown === state.owner ? (
        <HeldNotice
          notice={shown}
          bottom={height + 12}
          onDismiss={() => setShown(null)}
          widget={state.widget}
          inline={inline}
        />
      ) : null}
      {inline && children}
    </View>
  );
}
