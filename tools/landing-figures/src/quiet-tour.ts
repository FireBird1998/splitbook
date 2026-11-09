/** The quiet tour's story clock, relative to the framed tour. */
export const QUIET_TOUR_SPEED = 0.6;

export interface QuietTourControl {
  /** Page-wide pause; nothing is persisted. Resuming keeps the current scene. */
  setPaused(paused: boolean): void;
  stop(): void;
}
interface Scene {
  restart(): void;
  update(dt: number, calm: boolean): void;
  draw(): void;
  poseStill(): void;
}
interface SceneContext {
  svg: SVGSVGElement;
  held(): boolean;
  say(text: string): void;
  announce(text: string): void;
  tell(text: string): void;
}

/** Decorative playback only: no focus, input handlers, controls or live-region writes. */
export function runTour(
  root: HTMLElement,
  makeScene: (context: SceneContext) => Scene,
): QuietTourControl {
  const stage = root.querySelector<HTMLElement>('[data-stage]')!;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ignore = () => {};
  const scene = makeScene({
    svg: stage.querySelector('svg')!,
    held: () => media.matches,
    say: ignore,
    announce: ignore,
    tell: ignore,
  });
  let paused = false;
  let visible = false;
  let stopped = false;
  let frame = 0;
  let last = 0;
  const cancel = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  };
  function tick(now: number) {
    frame = 0;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    scene.update(dt * QUIET_TOUR_SPEED, false);
    scene.draw();
    run();
  }
  function run() {
    if (!stopped && visible && !paused && !media.matches && !frame)
      frame = requestAnimationFrame(tick);
  }
  function motionChanged() {
    cancel();
    if (media.matches) {
      scene.poseStill();
      scene.update(0, true);
    } else scene.restart();
    scene.draw();
    run();
  }
  const observer = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]!.isIntersecting;
    if (visible) run();
    else cancel();
  });
  motionChanged();
  observer.observe(stage);
  media.addEventListener('change', motionChanged);
  return {
    setPaused(value) {
      paused = value;
      if (paused) cancel();
      else run();
    },
    stop() {
      stopped = true;
      cancel();
      observer.disconnect();
      media.removeEventListener('change', motionChanged);
    },
  };
}

// Scenes keep their original geometry and exact, balancing counter arithmetic.
export { counterReadings, drawCounters, ease, lerp, rupees, signed } from './figures/tour.js';
