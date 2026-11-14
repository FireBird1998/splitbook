import { createSceneMotion } from './scene-motion';
/** Phone preference: deliberately outside accountLocal.stores and sign-out clearing. */
let deviceStorage: Parameters<typeof createSceneMotion>[0] | null = null;
export const sceneTilt = createSceneMotion(
  {
    load: () => deviceStorage?.load() ?? Promise.resolve(null),
    save: (value) => deviceStorage?.save(value) ?? Promise.resolve(),
  },
  'Tilt',
);
export function configureSceneTiltStorage(storage: NonNullable<typeof deviceStorage>) {
  deviceStorage = storage;
  return sceneTilt.restore();
}
