import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { MobileController } from '../data/mobile-controller';
import type { HeldNotificationOwner } from '../data/types';
import { Snackbar } from './compact/feedback';
import { useDismissAfter } from './group-snackbar';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';

/** Visibility is UI-only; the controller still owns the hold and its acknowledgement token. */
export function useHeldUpdateTimeline(controller: MobileController) {
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
  useEffect(() => {
    if (!state.notice) return;
    setShown(state.notice);
    controller.consumeHeldNotificationNotice(state.notice);
  }, [controller, state.notice]);
  useDismissAfter(shown, 4_000, () => setShown(null));
  return { owner: state.owner, shown: shown === state.owner ? shown : null, widget: state.widget };
}

export const HeldUpdateNoticeContext = createContext<
  (ReturnType<typeof useHeldUpdateTimeline> & { sheetId: string | null }) | null
>(null);

/** Feedback floats above the measured task bar; new surfaces reserve a row above controls. */
function Footer({
  shown,
  widget,
  children,
  inline,
}: {
  shown: HeldNotificationOwner | null;
  widget: boolean;
  children?: ReactNode;
  inline?: boolean;
}) {
  const [height, setHeight] = useState(0);
  return (
    <View onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
      {!inline && children}
      {shown ? (
        <Snackbar
          message={widget ? 'Widget held until you finish' : 'Update held until you finish'}
          bottom={height + 12}
          inline={inline}
        />
      ) : null}
      {inline && children}
    </View>
  );
}

function LocalFooter({ controller, ...props }: Parameters<typeof HeldUpdateFooter>[0]) {
  const timeline = useHeldUpdateTimeline(controller);
  return <Footer {...props} {...timeline} />;
}

export function HeldUpdateFooter(props: {
  controller: MobileController;
  children?: ReactNode;
  inline?: boolean;
  sheetId?: string;
}) {
  const timeline = useContext(HeldUpdateNoticeContext);
  return timeline ? (
    <Footer
      {...props}
      widget={timeline.widget}
      shown={timeline.sheetId === (props.sheetId ?? null) ? timeline.shown : null}
    />
  ) : (
    <LocalFooter {...props} />
  );
}
