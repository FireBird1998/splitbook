import { beforeAll, describe, expect, it, vi, afterEach } from 'vitest';
import { buildFigures, generatedFiles, OUT_DIR, type Figure } from './generate.ts';
import { QUIET_TOUR_SPEED, runTour } from './quiet-tour.ts';
import { quietPage, quietTourScript } from './quiet.ts';

let figures: Figure[];
beforeAll(() => {
  figures = buildFigures();
}, 60_000);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quiet public output', () => {
  it('provides each decorative figure and both stills without plate words or controls', () => {
    const files = generatedFiles(figures);
    for (const figure of figures) {
      const source = files.get(`${OUT_DIR}/${figure.id}-quiet.ts`);
      expect(source).toBeDefined();
      expect(source).toContain(`${figure.id}-quiet-light.png`);
      expect(source).toContain(`${figure.id}-quiet-dark.png`);
      for (const field of ['readout:', 'legend:', 'caption:', 'number:'])
        expect(source).not.toContain(field);
      for (const theme of ['light', 'dark'] as const) {
        const page = quietPage(figure, theme);
        expect(page).not.toMatch(/iso-plate|aria-live|tabindex|data-readout|<button/);
        expect(page).toContain('aria-hidden="true"');
      }
    }
  });

  it('ships the speed constant and a pause hook without stepping handlers', () => {
    expect(QUIET_TOUR_SPEED).toBe(0.6);
    for (const figure of figures) {
      const source = quietTourScript(figure, 'esm');
      expect(source).toContain('setPaused');
      expect(source).not.toMatch(/keydown|ArrowRight|Live tour/);
      expect(source).toContain('Anatomy kit');
    }
  });
});

function browser(reduced = false) {
  let notify: (entries: { isIntersecting: boolean }[]) => void;
  let change: () => void;
  const media = {
    matches: reduced,
    addEventListener: vi.fn((_, cb) => {
      change = cb;
    }),
    removeEventListener: vi.fn(),
  };
  const frames = new Map<number, (time: number) => void>();
  let id = 0;
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => {
    frames.delete(key);
  });
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: typeof notify) {
        notify = cb;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const scene = {
    update: vi.fn(),
    draw: vi.fn(),
    restart: vi.fn(),
    next: vi.fn(),
    poseStill: vi.fn(),
    settled: () => true,
  };
  const root = { querySelector: () => ({}) } as unknown as HTMLElement;
  const makeScene = vi.fn(() => scene);
  const control = runTour(root, makeScene);
  return {
    scene,
    frames,
    control,
    media,
    disconnect,
    makeScene,
    visible(value: boolean) {
      notify([{ isIntersecting: value }]);
    },
    motion(value: boolean) {
      media.matches = value;
      change();
    },
    frame(time: number) {
      const entry = [...frames][0];
      if (entry) {
        frames.delete(entry[0]);
        entry[1](time);
      }
    },
  };
}

describe('quiet motion', () => {
  it('autoplays only on screen at the exported speed; pause freezes and resume continues', () => {
    const b = browser();
    expect(b.frames.size).toBe(0);
    b.visible(true);
    b.frame(1000);
    b.frame(1020);
    expect(b.scene.update).toHaveBeenLastCalledWith(0.02 * QUIET_TOUR_SPEED, false);
    b.control.setPaused(true);
    expect(b.frames.size).toBe(0);
    const updates = b.scene.update.mock.calls.length;
    b.frame(5000);
    expect(b.scene.update).toHaveBeenCalledTimes(updates);
    b.control.setPaused(false);
    b.frame(6000);
    expect(b.scene.restart).toHaveBeenCalledTimes(1);
    expect(b.scene.update.mock.calls.length).toBeGreaterThan(updates);
    b.visible(false);
    expect(b.frames.size).toBe(0);
    b.control.stop();
    expect(b.disconnect).toHaveBeenCalledOnce();
  });

  it('never attaches click or key handlers and never writes a live region', () => {
    const b = browser();
    const context = b.makeScene.mock.calls[0]![0];
    context.say('ignored');
    context.announce('ignored');
    context.tell('ignored');
    b.visible(true);
    b.frame(1000);
    expect(b.scene.next).not.toHaveBeenCalled();
  });

  it('starts nothing under reduced motion and responds when the preference changes', () => {
    const b = browser(true);
    b.visible(true);
    b.control.setPaused(false);
    expect(b.frames.size).toBe(0);
    expect(b.scene.poseStill).toHaveBeenCalledOnce();
    expect(b.scene.restart).not.toHaveBeenCalled();
    b.motion(false);
    b.frame(1000);
    expect(b.scene.restart).toHaveBeenCalledOnce();
    b.motion(true);
    expect(b.frames.size).toBe(0);
    expect(b.scene.poseStill).toHaveBeenCalledTimes(2);
    b.control.stop();
    expect(b.media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
