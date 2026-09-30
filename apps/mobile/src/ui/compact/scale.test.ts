import { describe, expect, it } from 'vitest';
import { isLargeText, shouldDismissSheet } from './scale';

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
