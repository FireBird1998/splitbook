import { expect, it } from 'vitest';
import { createSceneMotion } from './scene-motion';
it('serializes overlapping writes and restores the last choice after the first slow write', async () => {
  let resolve!: () => void;
  const firstWrite = new Promise<void>((done) => {
    resolve = done;
  });
  let stored: string | null = null;
  const writes: string[] = [];
  const storage = {
    load: async () => stored,
    save: async (value: string) => {
      writes.push(value);
      if (value === 'off') await firstWrite;
      stored = value;
    },
  };
  const preference = createSceneMotion(storage);
  const first = preference.select(false);
  const second = preference.select(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(writes).toEqual(['off']);
  expect(preference.getSnapshot().enabled).toBe(true);
  resolve();
  await Promise.all([first, second]);
  expect(writes).toEqual(['off', 'on']);
  const restarted = createSceneMotion(storage);
  await restarted.restore();
  expect(restarted.getSnapshot().enabled).toBe(true);
});
