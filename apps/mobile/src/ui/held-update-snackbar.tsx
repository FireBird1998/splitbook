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
}: {
  notice: HeldNotificationOwner;
  bottom: number;
  onDismiss(): void;
}) {
  useDismissAfter(notice, 4_000, onDismiss);
  return <Snackbar message="Update held until you finish" bottom={bottom} />;
}

/** Feedback floats above the measured task bar without changing the form's scroll geometry. */
export function HeldUpdateFooter({
  controller,
  children,
}: {
  controller: MobileController;
  children?: ReactNode;
}) {
  const state = useMobileSnapshot(
    controller,
    (s) => ({
      owner: s.heldNotification,
      notice: s.heldNotificationNotice,
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
      {children}
      {shown && shown === state.owner ? (
        <HeldNotice notice={shown} bottom={height + 12} onDismiss={() => setShown(null)} />
      ) : null}
    </View>
  );
}
