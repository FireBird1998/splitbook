import { useRef, useState } from 'react';
import type { GestureResponderEvent, NativeTouchEvent } from 'react-native';

/**
 * How far a finger can move and still tap, in dp, in any direction: Android's touch slop
 * (`ViewConfiguration`'s scaled touch slop, 8dp), the distance at which a ScrollView starts to
 * drag.
 */
export const touchSlop = 8;

type Point = { x: number; y: number };

/** Where an event's finger is on the screen, or null for an event no finger made. */
function fingerAt(event?: GestureResponderEvent): Point | null {
  const native: Partial<NativeTouchEvent> | undefined = event?.nativeEvent;
  return typeof native?.pageX === 'number' && typeof native.pageY === 'number'
    ? { x: native.pageX, y: native.pageY }
    : null;
}

/**
 * Presses kept to taps (#665): a touch that moves further than `touchSlop` from where it landed,
 * in any direction, is a drag, and doesn't press, whether or not its list can scroll.
 *
 * In a list that scrolls, Android's ScrollView takes a drag at the slop and the press is
 * cancelled. A list too short to scroll never takes the touch, so the row keeps it, and
 * Pressability cancels only once the touch leaves the row's measured area: on a device, an upward
 * drag that started on an Expense opened it on 2 of about 9 drags. Where the touch landed, moved
 * and lifted come from the touch events themselves, so this doesn't depend on that measure.
 *
 * Spread `on(onPress)` onto a Pressable in place of its `onPress`, and show it pressed only while
 * the touch isn't `dragged`. One finger presses one Pressable at a time, so the options of a list
 * or a sheet can share one `useTap`. A press no finger made, such as TalkBack's activate
 * (Android's click, which has no position), always presses.
 */
export function useTap() {
  const landed = useRef<Point | null>(null);
  const moved = useRef(false);
  const [dragged, setDragged] = useState(false);
  const beyondSlop = (at: Point | null) => {
    const from = landed.current;
    return at !== null && from !== null && Math.hypot(at.x - from.x, at.y - from.y) > touchSlop;
  };
  // Touch events reach the Pressable from its start to its end, whatever Pressability decides.
  const onTouchStart = (event: GestureResponderEvent) => {
    landed.current = fingerAt(event);
    moved.current = false;
    setDragged(false);
  };
  const onTouchMove = (event: GestureResponderEvent) => {
    if (moved.current || !beyondSlop(fingerAt(event))) return;
    // Once a drag, the touch stays one, even back where it landed.
    moved.current = true;
    setDragged(true);
  };
  return {
    dragged,
    on: (onPress: (() => void) | undefined) => ({
      onTouchStart,
      onTouchMove,
      onPress: (event?: GestureResponderEvent) => {
        const lifted = fingerAt(event);
        // Where it lifts counts too: a fast swipe's moves can be coalesced away.
        if (lifted !== null && (moved.current || beyondSlop(lifted))) return;
        onPress?.();
      },
    }),
  };
}

/** A screen's or sheet's one `useTap`, handed to the presses it keeps to taps. */
export type Tap = ReturnType<typeof useTap>;
