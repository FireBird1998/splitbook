/**
 * The Settings switch for single-key shortcuts (#322, WCAG 2.1.4), kept per member on this
 * device: one `localStorage` entry per member, so members who share a browser each keep their
 * own. On unless the member turned them off here. Storage may be missing or refuse access
 * (private windows, blocked site data), so every read and write is guarded: a failed read means
 * on, and a failed write still holds for the rest of the visit.
 */

export interface SettingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const singleKeysStorageKey = (memberId: string) =>
  `splitbook:single-key-shortcuts:${memberId}`;

/** Whether single-key shortcuts are on for the member in `storage`. */
export function readSingleKeys(storage: SettingStorage | null, memberId: string): boolean {
  try {
    return storage?.getItem(singleKeysStorageKey(memberId)) !== 'off';
  } catch {
    return true;
  }
}

/** Keep the member's choice in `storage`; false when it couldn't be kept. */
export function writeSingleKeys(
  storage: SettingStorage | null,
  memberId: string,
  on: boolean,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(singleKeysStorageKey(memberId), on ? 'on' : 'off');
    return true;
  } catch {
    return false;
  }
}

/** The browser's `localStorage`, or null where reading it is refused. */
export function deviceStorage(): SettingStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Choices made this visit, which hold even where storage refused to keep them. */
const chosen = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** The member's setting on this device. */
export function singleKeysOn(memberId: string): boolean {
  return chosen.get(memberId) ?? readSingleKeys(deviceStorage(), memberId);
}

export function setSingleKeysOn(memberId: string, on: boolean): void {
  chosen.set(memberId, on);
  writeSingleKeys(deviceStorage(), memberId, on);
  listeners.forEach((listener) => listener());
}

/** Hear changes made on this page, and in the member's other tabs. */
export function subscribeSingleKeys(memberId: string, listener: () => void): () => void {
  const key = singleKeysStorageKey(memberId);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    // Another tab's choice replaces this visit's.
    chosen.delete(memberId);
    listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
