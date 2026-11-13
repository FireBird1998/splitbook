/** A phone preference, like Appearance: never registered in accountLocal.stores. */
export function createSceneMotion(storage: {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
}) {
  let snapshot = { enabled: true, message: null as string | null };
  let revision = 0;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (enabled: boolean, message: string | null = null) => {
    snapshot = { enabled, message };
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async restore() {
      const reading = revision;
      try {
        const value = await storage.load();
        if (reading === revision) publish(value !== 'off');
      } catch {
        if (reading === revision) publish(true, 'Couldn’t load Motion. Please choose again.');
      }
    },
    async select(enabled: boolean) {
      const change = ++revision;
      publish(enabled);
      writes = writes.catch(() => undefined).then(() => storage.save(enabled ? 'on' : 'off'));
      try {
        await writes;
      } catch {
        if (change === revision)
          publish(enabled, 'Couldn’t keep Motion on this phone. Please try again.');
      }
    },
  };
}

let deviceStorage: Parameters<typeof createSceneMotion>[0] | null = null;
export const sceneMotion = createSceneMotion({
  load: () => deviceStorage?.load() ?? Promise.resolve(null),
  save: (value) => deviceStorage?.save(value) ?? Promise.resolve(),
});
export function configureSceneMotionStorage(storage: NonNullable<typeof deviceStorage>) {
  deviceStorage = storage;
  return sceneMotion.restore();
}
