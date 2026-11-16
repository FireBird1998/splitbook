export interface PhoneSwitchStorage {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
}

/**
 * A switch kept on this phone, like Appearance: never registered in accountLocal.stores, so
 * sign-out and a change of account leave it as set. Until the member chooses, or when the phone
 * can't read the choice, it is `byDefault`.
 */
export function createPhoneSwitch(storage: PhoneSwitchStorage, label: string, byDefault: boolean) {
  let snapshot = { enabled: byDefault, message: null as string | null };
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
        if (reading === revision) publish(value === 'on' || (value !== 'off' && byDefault));
      } catch {
        if (reading === revision)
          publish(byDefault, `Couldn’t load ${label}. Please choose again.`);
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
          publish(enabled, `Couldn’t keep ${label} on this phone. Please try again.`);
      }
    },
  };
}
