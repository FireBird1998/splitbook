import { afterEach, describe, expect, it } from 'vitest';
import { Platform } from 'react-native';
import { isLargeText, lineBox, scaledSp, shouldDismissSheet } from './scale';

describe('large text threshold', () => {
  it('keeps two columns up to 115% and switches to one column from 130%', () => {
    expect(isLargeText(1)).toBe(false);
    expect(isLargeText(1.15)).toBe(false);
    expect(isLargeText(1.3)).toBe(true);
    expect(isLargeText(2)).toBe(true);
  });

  it('treats the scales Android reports as 32-bit floats as the settings they come from', () => {
    expect(isLargeText(1.149999976158142)).toBe(false);
    expect(isLargeText(1.2999999523162842)).toBe(true);
  });
});

describe('sheet swipe dismissal', () => {
  it('dismisses after a long drag or a downward fling', () => {
    expect(shouldDismissSheet({ dy: 120, vy: 0 })).toBe(true);
    expect(shouldDismissSheet({ dy: 30, vy: 1.2 })).toBe(true);
  });

  it('settles back for a short, slow or upward movement', () => {
    expect(shouldDismissSheet({ dy: 40, vy: 0.2 })).toBe(false);
    expect(shouldDismissSheet({ dy: 80, vy: 0 })).toBe(false);
    expect(shouldDismissSheet({ dy: -60, vy: 2 })).toBe(false);
  });
});

// #331: text on Android 14+ scales by the platform's curves, so a skeleton line must too. At
// 130% on an emulator, a record's 21sp heading line measured about 24dp and its 35sp amount
// line 35dp, where a straight ×1.3 gives 27.3 and 45.5.
describe('Android font scaling', () => {
  const version = Platform.Version;
  afterEach(() => {
    (Platform as { Version: unknown }).Version = version;
  });

  it('follows the platform’s table at 130%: small sizes by the whole scale, large ones by less', () => {
    expect(scaledSp(12, 1.3)).toBeCloseTo(15.6);
    expect(scaledSp(16, 1.3)).toBeCloseTo(20.2);
    expect(scaledSp(21, 1.3)).toBeCloseTo(24.3);
    expect(scaledSp(35, 1.3)).toBeCloseTo(35);
    expect(lineBox('form', 1.3).height).toBeCloseTo(35);
    expect(lineBox('heading', 1.3).height).toBeCloseTo(24.3);
  });

  it('interpolates between the platform’s scales, as for the 32-bit 130% Android reports', () => {
    expect(scaledSp(21, 1.2999999523162842)).toBeCloseTo(24.3, 3);
    expect(scaledSp(20, 1.2)).toBeCloseTo(21.8 + (23.6 - 21.8) / 3);
  });

  it('is linear below 115%, beyond 200%, and before Android 14', () => {
    expect(scaledSp(21, 1)).toBe(21);
    expect(scaledSp(21, 1.1)).toBeCloseTo(23.1);
    expect(scaledSp(21, 2.5)).toBeCloseTo(52.5);
    (Platform as { Version: unknown }).Version = 33;
    expect(scaledSp(21, 1.3)).toBeCloseTo(27.3);
  });
});
