import type { TextInstance } from 'react-native';
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  AccessibilityInfo,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { CompactButton, IconButton } from './controls';
import { useLineBox, useTextColumn } from './layout';
import { radius, shouldDismissSheet, touch } from './scale';
import { CompactText } from './text';

/**
 * The room above and below the header's action: a one-line title and its action (a 44 dp text
 * button, or a 48 dp ×) fill the header's 56 dp, where they sat when the header centred them.
 */
const headerEdge = (action: number) => (56 - action) / 2;

/**
 * A bottom sheet over the current screen: handle, header with Done, a scrolling body and a pinned
 * footer for totals and status. Swipe-down, tapping outside and Back all behave like Done, so
 * dismissing keeps entries unless the caller's Done discards them, as Record payment's Close
 * does (it says so through `dismissLabel`, and draws its Close as ×: `doneIcon`). It grows with
 * its content up to 90% of the screen.
 */
export function BottomSheet({
  visible,
  title,
  titleLines = 0,
  subtitle,
  titleAccessory,
  onDone,
  doneLabel = 'Done',
  doneIcon,
  dismissLabel = `Close ${title}, keeping your entries`,
  dismissible = true,
  titleRef,
  onShow,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  /**
   * Lines the title may take; by default, as many as it needs, as "Finish this expense later?"
   * needs two on a 360dp phone (#639). At large text, a title always takes as many as it needs,
   * and Done goes under it where it would leave it less than `largeTextColumn`.
   */
  titleLines?: number;
  /** Text, or text runs such as an amount in the money face. */
  subtitle?: ReactNode;
  /** Shown beside the title, e.g. a Required marker. */
  titleAccessory?: ReactNode;
  onDone: () => void;
  doneLabel?: string;
  /**
   * Draws Done as this icon, a 48 dp button named `doneLabel`: × for a sheet whose close
   * discards its entries, as Record payment's and Settle up's do. Sheets that keep entries keep
   * their words.
   */
  doneIcon?: 'close';
  /** The scrim's spoken label, when closing doesn't keep entries. */
  dismissLabel?: string;
  /** False while the sheet can't close, e.g. while it's saving: nothing closes it, and a swipe springs back. */
  dismissible?: boolean;
  /** The title, as for a sheet that moves the screen reader to it when it opens. */
  titleRef?: Ref<TextInstance>;
  /** Called once the sheet is on screen. */
  onShow?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const theme = useTheme();
  // At large text the title keeps room for its widest word, or Done goes under it: at 200% on a
  // 360 dp phone, "Venkataraghavan-" needs 299 dp, and beside the × it had 276 (#921).
  const column = useTextColumn(title, 'title');
  // The header's action keeps its centre on the title's first line, however many lines the
  // title takes (#646): whichever of the two is shorter starts lower by half the difference.
  const action = doneIcon ? touch.min : touch.dense;
  const lift = (useLineBox('title').height - action) / 2;
  const doneButton = doneIcon ? (
    <IconButton icon={doneIcon} label={doneLabel} disabled={!dismissible} onPress={onDone} />
  ) : (
    <CompactButton
      label={doneLabel}
      variant="text"
      dense
      disabled={!dismissible}
      onPress={onDone}
    />
  );
  const drag = useRef(new Animated.Value(0)).current;
  // The pan responder is created once; it reads the latest Done handler through this ref.
  const done = useRef(onDone);
  const closable = useRef(dismissible);
  useEffect(() => {
    done.current = onDone;
    closable.current = dismissible;
  }, [onDone, dismissible]);

  useEffect(() => {
    if (visible) drag.setValue(0);
  }, [visible, drag]);

  const pan = useMemo(() => {
    const settle = () => Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => drag.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) =>
        closable.current && shouldDismissSheet(gesture) ? done.current() : settle(),
      onPanResponderTerminate: settle,
    });
  }, [drag]);

  const scrim = theme.mode === 'dark' ? theme.bg : theme.text;
  const dismiss = () => {
    if (dismissible) onDone();
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={dismiss}
      onShow={onShow}
    >
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          accessibilityState={{ disabled: !dismissible }}
          disabled={!dismissible}
          onPress={dismiss}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: scrim,
            opacity: theme.mode === 'dark' ? 0.62 : 0.45,
          }}
        />
        <Animated.View
          accessibilityViewIsModal
          style={{
            maxHeight: '90%',
            backgroundColor: theme.bgElevated,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            transform: [{ translateY: drag }],
          }}
        >
          {/* The sheet draws edge to edge; its content stays above Android's navigation bar. */}
          <SafeAreaView edges={['bottom']} style={{ flexShrink: 1 }}>
            <View testID="sheet-drag-area" {...pan.panHandlers}>
              <View
                style={{
                  alignSelf: 'center',
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  marginTop: 10,
                  marginBottom: 2,
                  backgroundColor: theme.borderStrong,
                }}
              />
              <View
                style={{
                  minHeight: 56,
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 8,
                  paddingTop: headerEdge(action),
                  paddingBottom: headerEdge(action),
                  paddingLeft: 20,
                  paddingRight: 8,
                  // At 200% on a 360dp phone, "Keep editing" beside "Finish this expense
                  // later?" broke "expense" in two (#639).
                  ...(column ? { flexWrap: 'wrap', alignContent: 'flex-start', rowGap: 0 } : {}),
                }}
              >
                <View style={{ flex: 1, minWidth: column ?? 0, marginTop: Math.max(0, -lift) }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <CompactText
                      ref={titleRef}
                      variant="title"
                      accessibilityRole="header"
                      numberOfLines={column ? 0 : titleLines}
                      style={{ flexShrink: 1 }}
                    >
                      {title}
                    </CompactText>
                    {titleAccessory}
                  </View>
                  {subtitle ? (
                    <CompactText variant="caption" tone="secondary">
                      {subtitle}
                    </CompactText>
                  ) : null}
                </View>
                {/* On a line of its own, Done keeps to the header's end. */}
                <View
                  style={{
                    marginTop: Math.max(0, lift),
                    ...(column ? { marginLeft: 'auto' } : {}),
                  }}
                >
                  {doneButton}
                </View>
              </View>
            </View>
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingBottom: footer ? 8 : 20,
                gap: 12,
              }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {footer ? (
              <View
                style={{
                  paddingHorizontal: 20,
                  paddingTop: 12,
                  paddingBottom: 16,
                  gap: 6,
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                }}
              >
                {footer}
              </View>
            ) : null}
          </SafeAreaView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** What a ConfirmSheet asks: one destructive action, and the safe way out. */
export type Confirmation = {
  title: string;
  message: string;
  /** The destructive action, in red, such as "Discard". */
  action: string;
  /** The safe way out, such as "Keep editing". Back, a tap outside and a swipe down choose it. */
  cancel: string;
  onConfirm: () => void;
};

/**
 * The app's own confirm, in place of a stock dialog (#646): a title, a short message, the red
 * action in the footer and the safe way out as the header's action, as To review's Delete asks.
 * Back, a tap outside and a swipe down cancel; nothing but the red action confirms. The screen
 * reader moves to the title when it opens. It answers once: a second tap does nothing.
 */
export function ConfirmSheet({
  title,
  message,
  action,
  cancel,
  onConfirm,
  onCancel,
}: Confirmation & { onCancel: () => void }) {
  const heading = useRef<TextInstance>(null);
  const answered = useRef(false);
  const answer = (then: () => void) => () => {
    if (answered.current) return;
    answered.current = true;
    then();
  };
  return (
    <BottomSheet
      visible
      title={title}
      titleRef={heading}
      onShow={() => {
        if (heading.current) AccessibilityInfo.sendAccessibilityEvent(heading.current, 'focus');
      }}
      doneLabel={cancel}
      dismissLabel={cancel}
      onDone={answer(onCancel)}
      footer={<CompactButton label={action} destructive block onPress={answer(onConfirm)} />}
    >
      <CompactText>{message}</CompactText>
    </BottomSheet>
  );
}

/**
 * Asks with a ConfirmSheet: `ask(confirmation)` opens it, and the screen renders `sheet`, which
 * is mounted only while it asks, so a screen that isn't asking renders nothing more.
 */
export function useConfirm() {
  const [asking, ask] = useState<Confirmation | null>(null);
  const sheet = asking ? (
    <ConfirmSheet
      {...asking}
      onCancel={() => ask(null)}
      onConfirm={() => {
        ask(null);
        asking.onConfirm();
      }}
    />
  ) : null;
  return [ask as (confirmation: Confirmation) => void, sheet] as const;
}
