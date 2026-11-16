import { createPhoneSwitch, type PhoneSwitchStorage } from './phone-switch';

/** A phone preference, like Appearance: never registered in accountLocal.stores. On by default. */
export function createSceneMotion(storage: PhoneSwitchStorage, label = 'Motion') {
  return createPhoneSwitch(storage, label, true);
}

let deviceStorage: PhoneSwitchStorage | null = null;
export const sceneMotion = createSceneMotion({
  load: () => deviceStorage?.load() ?? Promise.resolve(null),
  save: (value) => deviceStorage?.save(value) ?? Promise.resolve(),
});
export function configureSceneMotionStorage(storage: PhoneSwitchStorage) {
  deviceStorage = storage;
  return sceneMotion.restore();
}
