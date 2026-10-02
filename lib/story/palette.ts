import type { Ink, Tone } from "./types";

/**
 * Application-owned colors for stories. Stories pick tokens; only this file
 * holds concrete values. The named CSS colors match the original
 * visualization (steelblue servers, green clients, red uncommitted entries).
 */
export const INK: Record<Ink, string> = {
  steelblue: "#4682b4",
  green: "#008000",
  red: "#e00000",
  orange: "#e07000",
  purple: "#7b3fa0",
  gray: "#9a9a9a",
  black: "#222222",
};

export const TONE: Record<Tone, string> = {
  normal: "#000000",
  pending: "#e00000",
  muted: "#a0a0a0",
  focus: INK.steelblue,
  good: INK.green,
  bad: "#e00000",
  warn: INK.orange,
  alt: INK.purple,
};

export const INKS = Object.keys(INK) as Ink[];
