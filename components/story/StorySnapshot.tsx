import { compileStory, currentEntity, worldAt, type World } from "@/lib/story/engine";
import { FULL_BOX, unionBox, type Box } from "@/lib/story/geometry";
import { footprint } from "@/lib/story/lint";
import type { Story } from "@/lib/story/types";
import { Stage } from "./Stage";

/** Logical size; the SVG scales to its container, text included. 5:3 like the cards. */
const WIDTH = 600;
const HEIGHT = 360;
const PAD = 5;
/** Where in-flight messages are drawn, as in reduced-motion mode. */
const MESSAGE_AT = 0.6;
/** Space kept around the content when zooming, in domain units. */
const MARGIN = 4;

/**
 * Camera that fills the frame with the scene: a square in domain units, so
 * both axes zoom by the same factor and the layout keeps its proportions.
 */
function fitCamera(world: World): Box {
  const boxes = [...world.live.values()].flatMap((live) => {
    const box = live.dying === null ? footprint(currentEntity(live), world) : null;
    return box ? [box] : [];
  });
  const content = unionBox(boxes);
  if (!content) return FULL_BOX;
  const side = Math.min(100, Math.max(content.x1 - content.x0, content.y1 - content.y0) + MARGIN * 2);
  const clamp = (center: number) => Math.min(100 - side / 2, Math.max(side / 2, center));
  const cx = clamp((content.x0 + content.x1) / 2);
  const cy = clamp((content.y0 + content.y1) / 2);
  return { x0: cx - side / 2, y0: cy - side / 2, x1: cx + side / 2, y1: cy + side / 2 };
}

/**
 * Static frame of a story: the scene at the end of one beat, zoomed to its
 * content, with that beat's messages frozen partway along their path.
 * Decorative; the surrounding card carries the meaning.
 */
export function StorySnapshot({ story, chapter, beat = 0 }: { story: Story; chapter?: string; beat?: number }) {
  const compiled = compileStory(story);
  const first = chapter ? (compiled.chapters.find((c) => c.id === chapter)?.first ?? 0) : 0;
  const target = compiled.beats[first + beat] ?? compiled.beats[0];
  if (!target) return null;
  const scene = worldAt(target.start, target.items, Infinity);
  const camera = fitCamera(scene);
  const world: World = { ...scene, camera: { from: camera, to: camera, at: -Infinity } };

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden focusable="false" className="block h-auto w-full bg-white">
      <g transform={`translate(${PAD},${PAD})`}>
        <Stage world={world} t={Infinity} width={WIDTH - PAD * 2} height={HEIGHT - PAD * 2} frozenMessagesAt={MESSAGE_AT} />
      </g>
    </svg>
  );
}
