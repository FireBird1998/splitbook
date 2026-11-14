import { expect, it } from 'vitest';
import { createSceneMotion } from './scene-motion';
import { configureSceneTiltStorage, sceneTilt } from './scene-tilt';
it('defaults Tilt on and restores the phone choice in a new instance', async () => {
  let stored: string | null = null;
  const storage = {
    load: async () => stored,
    save: async (value: string) => {
      stored = value;
    },
  };
  await configureSceneTiltStorage(storage);
  expect(sceneTilt.getSnapshot().enabled).toBe(true);
  await sceneTilt.select(false);
  const next = createSceneMotion(storage, 'Tilt');
  await next.restore();
  expect(next.getSnapshot().enabled).toBe(false);
});
it('reports a failed phone write without changing the choice', async () => {
  const pref = createSceneMotion(
    {
      load: async () => null,
      save: async () => {
        throw Error('locked');
      },
    },
    'Tilt',
  );
  await pref.select(false);
  expect(pref.getSnapshot()).toEqual({
    enabled: false,
    message: 'Couldn’t keep Tilt on this phone. Please try again.',
  });
});
it('a late restore cannot undo the most recent phone choice', async () => {
  let resolve!: (value: string) => void;
  const pref = createSceneMotion(
    {
      load: () =>
        new Promise((done) => {
          resolve = done;
        }),
      save: async () => {},
    },
    'Tilt',
  );
  const reading = pref.restore();
  await pref.select(false);
  resolve('on');
  await reading;
  expect(pref.getSnapshot().enabled).toBe(false);
});
