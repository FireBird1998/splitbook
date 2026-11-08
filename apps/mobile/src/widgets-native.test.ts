import { expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ runAsync: vi.fn(), exists: true }));
vi.mock('expo-sqlite', () => ({
  defaultDatabaseDirectory: '/data/user/0/com.splitbook.app.dev/files/SQLite',
  openDatabaseAsync: async () => ({ execAsync: vi.fn(), runAsync: native.runAsync }),
}));
vi.mock('expo-file-system', () => ({
  File: class {
    constructor(directory: string) {
      if (!directory.startsWith('file://')) throw new Error('URI is not absolute');
    }
    get exists() {
      return native.exists;
    }
  },
}));
import { createWidgetsStore } from './widgets-native';

it('purges an existing copy after a cold start using an absolute file URI', async () => {
  await createWidgetsStore('development').clear();
  expect(native.runAsync).toHaveBeenCalledWith(
    'DELETE FROM widget_state WHERE environment = ?',
    'development',
  );
});
