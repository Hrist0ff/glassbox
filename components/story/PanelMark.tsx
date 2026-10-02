import type { Live } from "@/lib/story/engine";
import type { Scales } from "@/lib/story/geometry";
import { MONO_FONT, presence } from "./draw";
import { ChartPanelBody } from "./panels/ChartPanel";
import { ComparisonPanelBody } from "./panels/ComparisonPanel";
import { mid, panelFrame } from "./panels/frame";
import { HierarchyPanelBody } from "./panels/HierarchyPanel";
import { SimplePanelBody, simpleAnchor } from "./panels/SimplePanels";
import { TimelinePanelBody } from "./panels/TimelinePanel";

/**
 * Panels: a log, code, a table, a timeline, a comparison, a hierarchy, or a
 * chart. Layout is in arena units (see PANEL in lib/concept/constants.ts and
 * the frames in lib/concept/frames.ts), drawn at one scale on both axes, so a
 * panel keeps its proportions when the camera zooms and always fits inside
 * the box the validator measured.
 */

type Point = { x: number; y: number };

/** Where messages to a panel land: the next free record of a log or version-1 timeline, otherwise the center. */
export function panelAnchor(live: Live, t: number, s: Scales, role: "from" | "to"): Point {
  const g = panelFrame(live, t, s);
  if (g.entity.frame) return mid(g.rect(0, 0, g.size.width, g.size.height));
  return simpleAnchor(g, live.cells.length, role);
}

export function PanelMark({ live, t, s, rate }: { live: Live; t: number; s: Scales; rate: number }) {
  const g = panelFrame(live, t, s);
  let body: React.ReactNode;
  switch (g.entity.frame?.kind) {
    case "timeline":
      body = <TimelinePanelBody g={g} live={live} t={t} rate={rate} />;
      break;
    case "comparison":
      body = <ComparisonPanelBody g={g} live={live} t={t} />;
      break;
    case "hierarchy":
      body = <HierarchyPanelBody g={g} live={live} t={t} rate={rate} />;
      break;
    case "chart":
      body = <ChartPanelBody g={g} live={live} t={t} />;
      break;
    default:
      body = (
        <>
          <SimpleTitle g={g} />
          <SimplePanelBody g={g} live={live} t={t} rate={rate} />
        </>
      );
  }

  return (
    <g data-entity-id={g.entity.id} data-panel={g.entity.variant} opacity={presence(live, t)} fontFamily={MONO_FONT}>
      {body}
    </g>
  );
}

function SimpleTitle({ g }: { g: ReturnType<typeof panelFrame> }) {
  if (!g.title) return null;
  return (
    <text
      x={g.rect(0, 0, 0, 0).x}
      y={g.rect(0, g.title * 0.5, 0, 0).y}
      fontSize={Math.min(g.title * g.k * 0.62, (g.size.width * g.k) / Math.max(1, g.entity.title.length * 0.6))}
      dominantBaseline="middle"
      fill="#333"
    >
      {g.entity.title}
    </text>
  );
}
