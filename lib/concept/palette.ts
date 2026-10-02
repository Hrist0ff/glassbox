import type { ColorToken } from "./schema";

/**
 * Application-owned mapping from semantic color tokens to concrete colors.
 * Generated content can only pick a token; it never supplies a color value,
 * class name, or style.
 */
export type TokenPaint = {
  /** Shape fill. */
  fill: string;
  /** Shape outline and status glyphs. */
  stroke: string;
  /** Short human word used in legends and scene descriptions. */
  word: string;
};

export const PALETTE: Record<ColorToken, TokenPaint> = {
  neutral: { fill: "#F2F1EC", stroke: "#57534E", word: "neutral" },
  primary: { fill: "#E2E9FD", stroke: "#2648C9", word: "in focus" },
  secondary: { fill: "#EEE6FC", stroke: "#6D35D6", word: "supporting" },
  success: { fill: "#DCF1E2", stroke: "#147A3B", word: "done / healthy" },
  warning: { fill: "#FCEFD3", stroke: "#A6520A", word: "pending" },
  danger: { fill: "#FBE2E0", stroke: "#B42318", word: "failed" },
};

export const INACTIVE_PAINT = { fill: "#FAFAF7", stroke: "#8A857D" } as const;
