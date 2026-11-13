'use client';

import { useSyncExternalStore } from 'react';

export interface ScenePreferences {
  motion: boolean;
  followPointer: boolean;
}
export const SCENE_PREFERENCES_KEY = 'splitbook-header-scene-preferences';
const defaults: ScenePreferences = { motion: true, followPointer: true };
let current = defaults;
let storageUnavailable = false;
const listeners = new Set<() => void>();
function restore() {
  if (storageUnavailable) return;
  try {
    const raw = window.localStorage.getItem(SCENE_PREFERENCES_KEY);
    let value: unknown;
    try {
      value = raw ? JSON.parse(raw) : null;
    } catch {
      value = null;
    }
    const stored = value && typeof value === 'object' ? (value as Partial<ScenePreferences>) : {};
    const next = {
      motion: typeof stored.motion === 'boolean' ? stored.motion : true,
      followPointer: typeof stored.followPointer === 'boolean' ? stored.followPointer : true,
    };
    if (next.motion !== current.motion || next.followPointer !== current.followPointer)
      current = next;
  } catch {
    storageUnavailable = true;
  }
}
function changedInAnotherTab(event: StorageEvent) {
  if (event.key !== SCENE_PREFERENCES_KEY && event.key !== null) return;
  restore();
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  if (!listeners.size) {
    restore();
    window.addEventListener('storage', changedInAnotherTab);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', changedInAnotherTab);
  };
}
const snapshot = () => current;
const serverSnapshot = () => defaults;
export function setScenePreferences(value: ScenePreferences) {
  current = value;
  try {
    window.localStorage.setItem(SCENE_PREFERENCES_KEY, JSON.stringify(value));
  } catch {
    storageUnavailable = true;
  }
  listeners.forEach((listener) => listener());
}
/** These two browser choices are outside account data and never part of a Group write. */
export function useScenePreferences() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
