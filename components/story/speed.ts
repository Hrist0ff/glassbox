"use client";

import { useSyncExternalStore } from "react";

/**
 * Playback speed of the story player: how fast story time runs compared with
 * the clock. Stories are timed at "fast" (the original's pace); "normal" is
 * the default. The choice is remembered per browser, as a convenience only.
 */
export const SPEEDS = { slow: 0.3, normal: 0.5, fast: 1 } as const;
export type Speed = keyof typeof SPEEDS;

const KEY = "stepwise:story-speed";
const DEFAULT: Speed = "normal";
const listeners = new Set<() => void>();
/** Fallback when storage is blocked, so the choice still applies until the page reloads. */
let chosen: Speed | null = null;

const isSpeed = (value: unknown): value is Speed => typeof value === "string" && Object.hasOwn(SPEEDS, value);

function read(): Speed {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch {
    // Storage blocked; fall back to this page's choice.
  }
  return isSpeed(stored) ? stored : (chosen ?? DEFAULT);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function setSpeed(speed: Speed) {
  chosen = speed;
  try {
    window.localStorage.setItem(KEY, speed);
  } catch {
    // Storage blocked: the choice applies until the page reloads.
  }
  for (const listener of listeners) listener();
}

export function useSpeed(): Speed {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}
