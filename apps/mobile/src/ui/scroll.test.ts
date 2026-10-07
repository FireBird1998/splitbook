import { describe, expect, it } from 'vitest';
import { scrollToShow } from './scroll';

// #331: Create Group's "Sending this Group…" note appeared under its button, cut off by the
// bottom of the screen; the form now scrolls just far enough to show it whole.
describe('scrolling a section into view', () => {
  const view = { offset: 400, viewport: 600 };

  it('scrolls down just far enough to show a section that ends below the view, with room', () => {
    // Ends at 1030: 1046 with the margin, 46 past the view's bottom at 1000.
    expect(scrollToShow({ top: 990, height: 40 }, view)).toBe(446);
  });

  it('leaves a section that already ends in view where it is', () => {
    expect(scrollToShow({ top: 900, height: 40 }, view)).toBeNull();
    expect(scrollToShow({ top: 944, height: 40 }, view)).toBeNull();
  });

  it('waits for the view to be laid out', () => {
    expect(scrollToShow({ top: 990, height: 40 }, { offset: 0, viewport: 0 })).toBeNull();
  });
});
