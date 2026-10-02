import { ease, FADE, progress, TWEEN } from "@/lib/story/engine";
import { MONO } from "@/lib/story/geometry";

/** Drawing helpers shared by the stage and its panels. */

export const MONO_FONT = '"Courier New", Courier, monospace';
export const SANS_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** CSS color fades, stretched to the playback rate like everything else. */
export const colorFade = (rate: number, properties = "fill") =>
  properties
    .split(",")
    .map((p) => `${p.trim()} ${Math.round(TWEEN / rate)}ms`)
    .join(", ");

/** Opacity of something fading in after `born` and out after `dying`. */
export function presence(live: { born: number; dying: number | null }, t: number): number {
  const fadeIn = ease(progress(t, live.born, TWEEN));
  const fadeOut = live.dying === null ? 1 : 1 - ease(progress(t, live.dying, FADE));
  return fadeIn * fadeOut;
}

/** Largest font (px) at most `preferred` that fits `chars` monospace characters in `room` px. */
export function fitFont(preferred: number, chars: number, room: number): number {
  return Math.min(preferred, room / Math.max(1, chars * MONO.advance));
}
