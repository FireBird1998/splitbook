import { vi, type MockInstance } from 'vitest';
import type { MobileDependencies } from '../data/types';

// Freshness runs on TanStack Query's clock, `Date.now` (ADR 0006, AMEND-2, #214). Suites written
// before that move the controller's injected clock (`now`) instead, and expect the 30-second
// window to follow it. So that they keep their commands and assertions (#145, decided
// 2026-10-05), a controller built with an injected clock makes `Date.now` read that clock until
// the test ends. A suite opts in by injecting `now`; one that doesn't leaves `Date.now` alone and
// moves time with vitest's fake timers, as new freshness tests do. `./setup.ts` wires this for
// every test file.

let spy: MockInstance<() => number> | null = null;

/** From now until the test ends, `Date.now` reads the controller's injected clock. */
export function followInjectedClock({ now }: Pick<MobileDependencies, 'now'>) {
  // A suite on fake timers moves `Date.now` itself.
  if (!now || vi.isFakeTimers()) return;
  spy?.mockRestore();
  spy = vi.spyOn(Date, 'now').mockImplementation(() => now());
}

/** `Date.now` reads the platform clock again. */
export function releaseInjectedClock() {
  spy?.mockRestore();
  spy = null;
}
