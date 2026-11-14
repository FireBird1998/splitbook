import { expect, it, vi } from 'vitest';
import { startHeaderTilt, type TiltSensor } from './header-tilt';

function sensor() {
  let callback: ((sample: { x: number; y: number }) => void) | undefined;
  const remove = vi.fn();
  const source: TiltSensor = {
    isAvailableAsync: async () => true,
    setUpdateInterval: vi.fn(),
    addListener: vi.fn((listener) => {
      callback = listener;
      return { remove };
    }),
  };
  return { source, remove, sample: (x: number, y: number) => callback?.({ x, y }) };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
it('calibrates, bounds movement and removes exactly its listener; ignores queued samples', async () => {
  const native = sensor();
  const move = vi.fn();
  const stop = startHeaderTilt(async () => native.source, move);
  await flush();
  expect(native.source.setUpdateInterval).toHaveBeenCalledWith(50);
  native.sample(0.2, 0.8);
  native.sample(5, -5);
  expect(move.mock.calls).toEqual([
    [0, 0],
    [1, -1],
  ]);
  stop();
  stop();
  native.sample(0, 0);
  expect(native.remove).toHaveBeenCalledTimes(1);
  expect(move).toHaveBeenCalledTimes(2);
});
it.each(['load', 'availability'])('does not register after disposal during %s', async (pending) => {
  const native = sensor();
  let resolve!: () => void;
  const wait = new Promise<void>((done) => {
    resolve = done;
  });
  if (pending === 'availability')
    native.source.isAvailableAsync = async () => {
      await wait;
      return true;
    };
  const stop = startHeaderTilt(async () => {
    if (pending === 'load') await wait;
    return native.source;
  }, vi.fn());
  await flush();
  stop();
  resolve();
  await flush();
  expect(native.source.addListener).not.toHaveBeenCalled();
});
it.each(['missing', 'failure'])('leaves a still scene when sensor is %s', async (condition) => {
  const native = sensor();
  native.source.isAvailableAsync = async () => {
    if (condition === 'failure') throw Error('disabled');
    return false;
  };
  const stop = startHeaderTilt(async () => native.source, vi.fn());
  await flush();
  stop();
  expect(native.source.addListener).not.toHaveBeenCalled();
});
