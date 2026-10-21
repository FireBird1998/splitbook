'use client';

// THROWAWAY SCOPES PROTOTYPE (#715): the library owns dispatch and priority.
import { getHotkeyManager } from '@tanstack/react-hotkeys';
import { SEARCH_SCOPE } from './ShortcutOverlay';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { setSingleKeysOn, singleKeysOn, subscribeSingleKeys } from './shortcut-setting';
import {
  hintShows,
  shortcut,
  shortcutAllowed,
  type Shortcut,
  type ShortcutId,
  type ShortcutTarget,
} from './shortcuts';

type Handler = () => void;

export interface ShortcutsValue {
  /** Whether single-key shortcuts are on; null until this device's setting is read. */
  singleKeys: boolean | null;
  setSingleKeys: (on: boolean) => void;
  /** Handle a shortcut while mounted; returns the unregister. */
  register: (id: ShortcutId, run: Handler, fallback: boolean) => () => void;
  /**
   * Hand a shortcut on to the page about to open: the next handler that registers for it
   * within a few seconds runs once, as it mounts (/ on another tab opens Expenses, then
   * focuses its search).
   */
  handOn: (id: ShortcutId) => void;
}

const noop = () => {};

/** Outside the provider (unit tests, the sign-in pages) nothing is registered and no hint shows. */
export const ShortcutsContext = createContext<ShortcutsValue>({
  singleKeys: null,
  setSingleKeys: noop,
  register: () => noop,
  handOn: noop,
});

/** How long a handed-on shortcut waits for its page. */
const HAND_ON_MS = 10_000;

/** The parts of a focused element the guard reads. */
export function describeTarget(element: Element | null): ShortcutTarget | null {
  if (!(element instanceof HTMLElement)) return null;
  return {
    tagName: element.tagName,
    type: element instanceof HTMLInputElement ? element.type : undefined,
    isContentEditable: element.isContentEditable,
    role: element.getAttribute('role'),
  };
}

let nextScope = 0;

/**
 * Keyboard shortcuts for the signed-in shell (#322): the member's single-key setting on this
 * device, and one listener for the page's shortcuts (N, /, ⌘K), which runs the handler the
 * page has registered for each. The Expense table handles its own keys while it has focus.
 */
export function ShortcutsProvider({ memberId, children }: PropsWithChildren<{ memberId: string }>) {
  const singleKeys = useSyncExternalStore(
    useCallback((listener: () => void) => subscribeSingleKeys(memberId, listener), [memberId]),
    () => singleKeysOn(memberId),
    () => null,
  );
  const handedOn = useRef<{ id: ShortcutId; at: number } | null>(null);

  const currentSingleKeys = useRef(singleKeys);
  useEffect(() => {
    currentSingleKeys.current = singleKeys;
  }, [singleKeys]);

  const register = useCallback(
    (id: ShortcutId, run: Handler, fallback: boolean) => {
      const manager = getHotkeyManager();
      const entry = shortcut(id);
      // The shell's fallback is global; mounted page handlers outrank it automatically.
      const scope = id === 'search' ? SEARCH_SCOPE : fallback ? 'global' : `page-${++nextScope}`;
      const release = manager.activateScope(scope);
      const bindings = entry.bindings.map((binding) =>
        manager.register(
          binding,
          (event) => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (
              event.defaultPrevented ||
              event.key.toLowerCase() !== entry.key ||
              !shortcutAllowed(entry, event, {
                singleKeys: currentSingleKeys.current,
                target: describeTarget(target),
                inSearchField: target?.matches('[data-search-input]') ?? false,
              })
            )
              return;
            event.preventDefault();
            handedOn.current = null;
            run();
          },
          {
            scope,
            target: window,
            capture: false,
            eventType: 'keydown',
            ignoreInputs: false,
            preventDefault: false,
            stopPropagation: false,
            requireReset: false,
            conflictBehavior: 'allow',
          },
        ),
      );
      const waiting = handedOn.current;
      if (!fallback && waiting?.id === id) {
        handedOn.current = null;
        if (Date.now() - waiting.at < HAND_ON_MS) run();
      }
      return () => {
        bindings.forEach((binding) => binding.unregister());
        release();
      };
    },
    [currentSingleKeys, handedOn],
  );

  const handOn = useCallback((id: ShortcutId) => {
    handedOn.current = { id, at: Date.now() };
  }, []);

  const setSingleKeys = useCallback((on: boolean) => setSingleKeysOn(memberId, on), [memberId]);

  const value = useMemo<ShortcutsValue>(
    () => ({ singleKeys, setSingleKeys, register, handOn }),
    [singleKeys, setSingleKeys, register, handOn],
  );
  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}

/** The member's single-key setting on this device, for the Settings switch and the hints. */
export function useShortcutSetting() {
  const { singleKeys, setSingleKeys } = useContext(ShortcutsContext);
  return { singleKeys, setSingleKeys };
}

/**
 * Run `handler` when the page's shortcut `id` is pressed, while this component is mounted. A
 * `fallback` handler runs only when no other one is registered for the shortcut.
 */
export function useShortcut(id: ShortcutId, handler: Handler, options?: { fallback?: boolean }) {
  const { register } = useContext(ShortcutsContext);
  const run = useEffectEvent(handler);
  const fallback = options?.fallback ?? false;
  useEffect(() => register(id, () => run(), fallback), [register, id, fallback]);
}

/** Hand a shortcut on to the page about to open (see `ShortcutsValue.handOn`). */
export function useHandOnShortcut() {
  return useContext(ShortcutsContext).handOn;
}

/** The shortcut, when its hint should show next to its control; null while it does nothing. */
export function useShortcutHint(id: ShortcutId): Shortcut | null {
  const { singleKeys } = useContext(ShortcutsContext);
  const entry = shortcut(id);
  return hintShows(entry, singleKeys) ? entry : null;
}
