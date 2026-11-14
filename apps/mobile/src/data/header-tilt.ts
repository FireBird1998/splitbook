/** A single cancellable sensor lease. Loading never starts until every policy gate allows it. */
export interface TiltSensor {
  isAvailableAsync(): Promise<boolean>;
  setUpdateInterval(milliseconds: number): void;
  addListener(listener: (sample: { x: number; y: number }) => void): { remove(): void };
}
export function startHeaderTilt(
  load: () => Promise<TiltSensor>,
  move: (x: number, y: number) => void,
) {
  let alive = true;
  let subscription: { remove(): void } | undefined;
  let origin: { x: number; y: number } | undefined;
  void (async () => {
    try {
      const sensor = await load();
      if (!alive || !(await sensor.isAvailableAsync()) || !alive) return;
      sensor.setUpdateInterval(50);
      subscription = sensor.addListener((sample) => {
        if (!alive || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) return;
        origin ??= { x: sample.x, y: sample.y };
        const clamp = (n: number) => Math.max(-1, Math.min(1, n));
        move(clamp((sample.x - origin.x) * 2), clamp((sample.y - origin.y) * 2));
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
