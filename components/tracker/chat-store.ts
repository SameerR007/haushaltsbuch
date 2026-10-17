"use client";

import { useSyncExternalStore } from "react";

type Updater<V> = V | ((current: V) => V);

/**
 * State that outlives one mount of a component. The chat keeps its transcript, attachment, and
 * in-flight work here, so leaving Chat for Expenses and coming back does not drop a running import.
 * It lives for this page load only; a reload starts from what the browser stored.
 */
export function createChatStore<S extends object>(initial: S) {
  let state = initial;
  const listeners = new Set<() => void>();
  const setters = new Map<keyof S, (next: Updater<S[keyof S]>) => void>();

  function get(): S {
    return state;
  }

  function set<K extends keyof S>(key: K, next: Updater<S[K]>): void {
    const value =
      typeof next === "function" ? (next as (current: S[K]) => S[K])(state[key]) : next;
    if (Object.is(value, state[key])) return;
    state = { ...state, [key]: value };
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setterFor<K extends keyof S>(key: K): (next: Updater<S[K]>) => void {
    let setter = setters.get(key);
    if (!setter) {
      setter = (next) => set(key, next as Updater<S[K]>);
      setters.set(key, setter);
    }
    return setter as (next: Updater<S[K]>) => void;
  }

  /** Like useState, but the value is shared and survives unmount. The setter is stable. */
  function useField<K extends keyof S>(key: K): [S[K], (next: Updater<S[K]>) => void] {
    const value = useSyncExternalStore(
      subscribe,
      () => state[key],
      () => initial[key],
    );
    return [value, setterFor(key)];
  }

  return { get, set, subscribe, useField };
}
