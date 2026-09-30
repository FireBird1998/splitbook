import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useTheme } from '../theme';
import { CompactButton } from './controls';
import { radius, shouldDismissSheet } from './scale';
import { CompactText } from './text';

/**
 * A bottom sheet over the current screen: handle, header with Done, a scrolling body and a pinned
 * footer for totals and status. Swipe-down, tapping outside and Back all behave like Done, so
 * dismissing never discards entries. It grows with its content up to 90% of the screen.
 */
export function BottomSheet({
  visible,
  title,
  subtitle,
  titleAccessory,
  onDone,
  doneLabel = 'Done',
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Shown beside the title, e.g. a Required marker. */
  titleAccessory?: ReactNode;
  onDone: () => void;
  doneLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const drag = useRef(new Animated.Value(0)).current;
  // The pan responder is created once; it reads the latest Done handler through this ref.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

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
        shouldDismissSheet(gesture) ? done.current() : settle(),
      onPanResponderTerminate: settle,
    });
  }, [drag]);

  const scrim = theme.mode === 'dark' ? theme.bg : theme.text;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onDone}
    >
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          testID="sheet-scrim"
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}, keeping your entries`}
          onPress={onDone}
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
                alignItems: 'center',
                gap: 8,
                paddingLeft: 20,
                paddingRight: 8,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <CompactText variant="title" accessibilityRole="header" numberOfLines={1}>
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
              <CompactButton label={doneLabel} variant="text" dense onPress={onDone} />
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
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
