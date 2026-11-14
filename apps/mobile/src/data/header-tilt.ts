/** A single cancellable sensor lease. Loading never starts until every policy gate allows it. */
export interface TiltSensor {
  isAvailableAsync(): Promise<boolean>;
  setUpdateInterval(milliseconds: number): void;
  addListener(listener: (sample: { x: number; y: number }) => void): { remove(): void };
}
/** A change smaller than this share of full tilt is hand tremor: no animation is started for it. */
export const TILT_STILLNESS = 0.02;
/** Each sample moves the resting point this far toward the phone's pose, so a held tilt settles back. */
export const TILT_RECENTRE = 0.01;
export function startHeaderTilt(
  load: () => Promise<TiltSensor>,
  move: (x: number, y: number) => void,
) {
  let alive = true;
  let subscription: { remove(): void } | undefined;
  let origin: { x: number; y: number } | undefined;
  let sent: { x: number; y: number } | undefined;
  void (async () => {
    try {
      const sensor = await load();
      if (!alive || !(await sensor.isAvailableAsync()) || !alive) return;
      sensor.setUpdateInterval(50);
      subscription = sensor.addListener((sample) => {
        if (!alive || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) return;
        origin ??= { x: sample.x, y: sample.y };
        const clamp = (n: number) => Math.max(-1, Math.min(1, n));
        const next = { x: clamp((sample.x - origin.x) * 2), y: clamp((sample.y - origin.y) * 2) };
        origin.x += clamp(sample.x - origin.x) * TILT_RECENTRE;
        origin.y += clamp(sample.y - origin.y) * TILT_RECENTRE;
        if (
          sent &&
          Math.abs(next.x - sent.x) < TILT_STILLNESS &&
          Math.abs(next.y - sent.y) < TILT_STILLNESS
        )
          return;
        sent = next;
        move(next.x, next.y);
      });
    } catch {
      // Missing/disabled sensors leave a still scene, without a permission prompt.
    }
  })();
  return () => {
    if (!alive) return;
    alive = false;
    subscription?.remove();
  };
}
