/** Throwaway #715: mounts the real React hook and dispatches real EventTarget events. */
import { act, createElement, StrictMode, useContext, useEffect } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHotkeyManager } from '@tanstack/react-hotkeys';
import {
  ShortcutsContext,
  ShortcutsProvider,
  useShortcut,
  type ShortcutsValue,
} from './ShortcutsProvider';
import { singleKeysStorageKey } from './shortcut-setting';
import type { ShortcutId } from './shortcuts';
import { ShortcutOverlay } from './ShortcutOverlay';

// Strict mode reproduces the two migration blockers as ordinary failing tests.
const priorityTest = process.env.HOTKEYS_PROTOTYPE_STRICT === '1' ? it : it.fails;

class ElementStub {
  constructor(
    public tagName = 'BODY',
    public type = 'text',
    public role: string | null = null,
  ) {}
  isContentEditable = false;
  search = false;
  getAttribute() {
    return this.role;
  }
  matches() {
    return this.search;
  }
}

class InputStub extends ElementStub {
  constructor() {
    super('INPUT');
  }
}

class WindowStub extends EventTarget {
  document = { querySelector: () => null };
  localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };
}

interface Registration {
  id: ShortcutId;
  run: () => void;
  fallback?: boolean;
}
let storage: Map<string, string>;
let browser: WindowStub;
let root: ReactTestRenderer | undefined;
let api: ShortcutsValue;
let member = 0;

function Handler({ id, run, fallback }: Registration) {
  useShortcut(id, run, { fallback });
  return null;
}
function Probe() {
  const value = useContext(ShortcutsContext);
  useEffect(() => {
    api = value;
  }, [value]);
  return null;
}
async function mount(registrations: Registration[], strict = false) {
  const children = createElement(
    ShortcutsProvider,
    { memberId: `prototype-${member}` },
    createElement(Probe),
    ...registrations.map((registration, index) =>
      createElement(Handler, { ...registration, key: index }),
    ),
  );
  await act(async () => {
    root = create(strict ? createElement(StrictMode, null, children) : children);
  });
}
function key(key: string, options: Record<string, unknown> = {}, target = new ElementStub()) {
  const event = new Event('keydown', { cancelable: true, bubbles: true });
  Object.assign(event, {
    key,
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...options,
  });
  Object.defineProperty(event, 'target', { value: target });
  browser.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  member++;
  storage = new Map();
  browser = new WindowStub();
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', browser.document);
  vi.stubGlobal('HTMLElement', ElementStub);
  vi.stubGlobal('HTMLInputElement', InputStub);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  getHotkeyManager().destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('real React Hotkeys prototype integration', () => {
  it('page shortcut leaves an already prevented event untouched', async () => {
    const run = vi.fn();
    browser.addEventListener('keydown', (event) => event.preventDefault());
    await mount([{ id: 'add-expense', run }]);
    key('n');
    expect(run).not.toHaveBeenCalled();
  });
  it('unhandled or blocked shortcut does not prevent default or stop propagation', async () => {
    await mount([]);
    expect(key('n').defaultPrevented).toBe(false);
    const run = vi.fn();
    await act(async () => root?.unmount());
    root = undefined;
    await mount([{ id: 'add-expense', run }]);
    const event = key('n', {}, new InputStub());
    expect(event.defaultPrevented).toBe(false);
    expect(event.cancelBubble).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it('one matching page action runs once, including Shift slash', async () => {
    const run = vi.fn();
    await mount([{ id: 'search-group', run }]);
    expect(key('/', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('Control K and Meta K work with strict modifiers and preserve repetition', async () => {
    const run = vi.fn();
    await mount([{ id: 'search', run }]);
    key('k', { ctrlKey: true });
    key('K', { metaKey: true });
    key('k', { metaKey: true, repeat: true });
    expect(run).toHaveBeenCalledTimes(3);
    for (const flags of [
      { ctrlKey: true, metaKey: true },
      { ctrlKey: true, shiftKey: true },
      { metaKey: true, altKey: true },
      {},
    ])
      expect(key('k', flags).defaultPrevented).toBe(false);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('Shift letters work but unrelated characters at their physical position do not', async () => {
    const run = vi.fn();
    await mount([{ id: 'add-expense', run }]);
    key('N', { shiftKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(key('ж', { code: 'KeyN' }).defaultPrevented).toBe(false);
    expect(key('Dead', { code: 'KeyN' }).defaultPrevented).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('composition and editable ARIA widgets suppress single keys', async () => {
    const run = vi.fn();
    await mount([{ id: 'add-expense', run }]);
    expect(key('n', { isComposing: true }).defaultPrevented).toBe(false);
    expect(key('n', {}, new ElementStub('DIV', '', 'combobox')).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it('nested overlay scopes suspend page keys until the last overlay closes, while search stays available', async () => {
    const add = vi.fn(),
      search = vi.fn();
    const view = (outer: boolean, inner: boolean) =>
      createElement(
        ShortcutsProvider,
        { memberId: `prototype-${member}` },
        createElement(Handler, { id: 'add-expense', run: add }),
        createElement(Handler, { id: 'search', run: search }),
        createElement(
          ShortcutOverlay,
          { active: outer },
          createElement(ShortcutOverlay, { active: inner }, null),
        ),
      );
    await act(async () => {
      root = create(view(true, true));
    });
    expect(key('n').defaultPrevented).toBe(false);
    key('k', { ctrlKey: true });
    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => {
      root?.update(view(true, false));
    });
    expect(key('n').defaultPrevented).toBe(false);
    expect(add).not.toHaveBeenCalled();
    await act(async () => {
      root?.update(view(false, false));
    });
    key('n');
    expect(add).toHaveBeenCalledTimes(1);
  });
  it('ordinary fields retain search chords; search field toggles search', async () => {
    const run = vi.fn();
    await mount([{ id: 'search', run }]);
    const input = new InputStub();
    expect(key('k', { ctrlKey: true }, input).defaultPrevented).toBe(false);
    input.search = true;
    expect(key('k', { ctrlKey: true }, input).defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('first observed repeat never adds an Expense and repeated search still runs', async () => {
    const run = vi.fn();
    await mount([{ id: 'add-expense', run }]);
    expect(key('n', { repeat: true }).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
  it('latest real registration wins while fallback stays available', async () => {
    const fallback = vi.fn(),
      earlier = vi.fn(),
      latest = vi.fn();
    await mount([
      { id: 'search-group', run: fallback, fallback: true },
      { id: 'search-group', run: earlier },
      { id: 'search-group', run: latest },
    ]);
    key('/');
    expect(latest).toHaveBeenCalledTimes(1);
    expect(earlier).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    const extra = vi.fn();
    const remove = api.register('search-group', extra, false);
    key('/');
    expect(extra).toHaveBeenCalledTimes(1);
    remove();
    key('/');
    expect(latest).toHaveBeenCalledTimes(2);
  });
  it('unregistering the last real handler restores a fallback mounted after it', async () => {
    await mount([]);
    const real = vi.fn(),
      fallback = vi.fn();
    const remove = api.register('search-group', real, false);
    const removeFallback = api.register('search-group', fallback, true);
    key('/');
    expect(real).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    remove();
    key('/');
    expect(fallback).toHaveBeenCalledTimes(1);
    removeFallback();
    expect(key('/').defaultPrevented).toBe(false);
  });
  // Known scope-only mismatch: expected to fail; this blocks migration, not an accepted regression.
  priorityTest(
    'the latest fallback wins and removing it restores the earlier fallback',
    async () => {
      await mount([]);
      const first = vi.fn(),
        latest = vi.fn();
      const removeFirst = api.register('search-group', first, true);
      const removeLatest = api.register('search-group', latest, true);
      key('/');
      expect(latest).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
      removeLatest();
      key('/');
      expect(first).toHaveBeenCalledTimes(1);
      removeFirst();
    },
  );
  priorityTest(
    'the latest global search handler wins and its predecessor resumes after unmount',
    async () => {
      await mount([]);
      const first = vi.fn(),
        latest = vi.fn();
      const removeFirst = api.register('search', first, false);
      const removeLatest = api.register('search', latest, false);
      key('k', { ctrlKey: true });
      expect(latest).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
      removeLatest();
      key('k', { ctrlKey: true });
      expect(first).toHaveBeenCalledTimes(1);
      removeFirst();
    },
  );
  it('handoff runs once before expiry and never after expiry', async () => {
    await mount([]);
    const run = vi.fn();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    api.handOn('search-group');
    api.register('search-group', run, true);
    expect(run).not.toHaveBeenCalled();
    api.register('search-group', run, false);
    api.register('search-group', run, false);
    expect(run).toHaveBeenCalledTimes(1);
    api.handOn('search-group');
    now.mockReturnValue(11000);
    api.register('search-group', run, false);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('member preference disables single keys while search stays enabled', async () => {
    storage.set(singleKeysStorageKey(`prototype-${member}`), 'off');
    const run = vi.fn(),
      search = vi.fn();
    await mount([
      { id: 'add-expense', run },
      { id: 'search', run: search },
    ]);
    key('n');
    key('k', { ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => api.setSingleKeys(true));
    key('n');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('refused storage preserves the visit preference across remounts and keeps search available', async () => {
    Object.defineProperty(browser, 'localStorage', {
      get() {
        throw new Error('Storage refused');
      },
    });
    const add = vi.fn(),
      search = vi.fn();
    const registrations: Registration[] = [
      { id: 'add-expense', run: add },
      { id: 'search', run: search },
    ];
    await mount(registrations);
    key('n');
    expect(add).toHaveBeenCalledTimes(1);
    await act(async () => api.setSingleKeys(false));
    await act(async () => root?.unmount());
    root = undefined;
    await mount(registrations);
    expect(key('n').defaultPrevented).toBe(false);
    key('k', { ctrlKey: true });
    expect(add).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('switching members replaces the shortcut preference without duplicating actions', async () => {
    const add = vi.fn();
    await mount([{ id: 'add-expense', run: add }]);
    await act(async () => api.setSingleKeys(false));
    expect(key('n').defaultPrevented).toBe(false);
    await act(async () =>
      root?.update(
        createElement(
          ShortcutsProvider,
          { memberId: `another-${member}` },
          createElement(Handler, { id: 'add-expense', run: add }),
        ),
      ),
    );
    key('n');
    expect(add).toHaveBeenCalledTimes(1);
  });
  it('Strict Mode remount and route unmount leave no duplicate registrations', async () => {
    const run = vi.fn();
    await mount([{ id: 'add-expense', run }], true);
    key('n');
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => root?.unmount());
    root = undefined;
    expect(getHotkeyManager().getRegistrationCount()).toBe(0);
    expect(key('n').defaultPrevented).toBe(false);
    await mount([{ id: 'add-expense', run }], true);
    key('n');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
