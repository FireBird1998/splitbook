import { useEffect, useState } from 'react';
import { Animated, AppState, Easing } from 'react-native';
import { startHeaderTilt } from '../data/header-tilt';
import { useReducedMotion } from './compact/motion';

export function useHeaderTilt(enabled: boolean) {
  const reduced = useReducedMotion();
  const [position] = useState(() => ({ x: new Animated.Value(0), y: new Animated.Value(0) }));
  useEffect(() => {
    if (!enabled || reduced) return;
    let stop: (() => void) | undefined;
    let animations: ReturnType<typeof Animated.timing>[] = [];
    const reset = () => {
      stop?.();
      stop = undefined;
      animations.forEach((animation) => animation.stop());
      position.x.setValue(0);
      position.y.setValue(0);
    };
    const update = (active: boolean) => {
      reset();
      if (!active) return;
      stop = startHeaderTilt(
        () => import('expo-sensors').then((module) => module.Accelerometer),
        (x, y) => {
          animations.forEach((animation) => animation.stop());
          animations = [
            Animated.timing(position.x, {
              toValue: x,
              duration: 120,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
              isInteraction: false,
            }),
            Animated.timing(position.y, {
              toValue: y,
              duration: 120,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
              isInteraction: false,
            }),
          ];
          animations.forEach((animation) => animation.start());
        },
      );
    };
    update(AppState.currentState === 'active');
    const app = AppState.addEventListener('change', (state) => update(state === 'active'));
    return () => {
      app.remove();
      reset();
    };
  }, [enabled, reduced, position]);
  return position;
}
