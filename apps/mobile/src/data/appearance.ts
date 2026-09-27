export type AppearanceMode = 'system' | 'light' | 'dark';
export interface AppearanceSnapshot {
  mode: AppearanceMode;
  status: 'loading' | 'ready' | 'saving' | 'error';
  message: string | null;
}
export interface AppearanceStorage {
  load(): Promise<string | null>;
  save(mode: AppearanceMode): Promise<void>;
}

/** A device preference, deliberately separate from account-owned financial data. */
export function createAppearanceController(storage: AppearanceStorage) {
  let snapshot: AppearanceSnapshot = { mode: 'system', status: 'loading', message: null };
  let savedMode: AppearanceMode = 'system';
  let revision = 0;
  let writes: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (next: AppearanceSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const restore = async () => {
    if (snapshot.status === 'saving') return;
    const reading = ++revision;
    publish({ ...snapshot, status: 'loading', message: null });
    try {
      const saved = await storage.load();
      if (reading !== revision) return;
      const mode = saved === 'light' || saved === 'dark' ? saved : 'system';
      savedMode = mode;
      publish({ mode, status: 'ready', message: null });
    } catch {
      if (reading !== revision) return;
      publish({
        ...snapshot,
        status: 'error',
        message: 'Couldn’t load your appearance preference. Try again or choose an appearance.',
      });
    }
  };
  const select = async (mode: AppearanceMode) => {
    const selected = ++revision;
    publish({ mode, status: 'saving', message: null });
    const saving = writes.catch(() => undefined).then(() => storage.save(mode));
    writes = saving;
    try {
      await saving;
      savedMode = mode;
      if (selected !== revision) return;
      publish({ mode, status: 'ready', message: null });
    } catch {
      if (selected !== revision) return;
      publish({
        mode: savedMode,
        status: 'error',
        message:
          'Couldn’t save your appearance. Your previous choice is still selected. Try again.',
      });
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    restore,
    select,
  };
}
