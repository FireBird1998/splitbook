import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
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
  | (ReturnType<typeof useHeldUpdateTimeline> & {
      hostId: string | null;
      register(id: string, depth: number): () => void;
      active: boolean;
    })
  | null
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
  hostId?: string;
}) {
  const timeline = useContext(HeldUpdateNoticeContext);
  const id = useId();
  const register = timeline?.register;
  const active = timeline?.active;
  // Existing task bars keep their layout; a native modal always takes precedence.
  useEffect(() => {
    if (active && register && !props.inline && !props.hostId) return register(id, -1);
  }, [active, register, props.inline, props.hostId, id]);
  return timeline ? (
    <Footer
      {...props}
      widget={timeline.widget}
      shown={
        timeline.hostId === (props.hostId ?? (props.inline ? null : id)) ? timeline.shown : null
      }
    />
  ) : (
    <LocalFooter {...props} />
  );
}
