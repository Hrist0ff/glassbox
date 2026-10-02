"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Concept } from "@/lib/concept/schema";
import { SourcesPanel } from "./SourcesPanel";

/**
 * Top-bar buttons for step-level tools and the drawer they open: "Sources"
 * (evidence and assumptions) and, where generation is available, "Explore"
 * (explain, simplify, another example). The drawer follows the step the
 * reader is on. Escape or the close button closes it and returns focus.
 */

type Tool = "sources" | "explore";

export function StepTools({
  concept,
  step,
  origin,
  explore,
  onDrawer,
}: {
  concept: Concept;
  step: string | null;
  origin: "generated" | "bundled" | "eval";
  /** Content of the Explore drawer; omitted where exploring is not available. */
  explore?: (step: string | null) => ReactNode;
  /** Told when the drawer opens or closes, so the player can make room. */
  onDrawer?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState<Tool | null>(null);
  // Once opened, Explore stays mounted (hidden when closed), so closing the drawer never cancels a request in progress.
  const [exploreMounted, setExploreMounted] = useState(false);
  useEffect(() => onDrawer?.(open !== null), [open, onDrawer]);
  const buttons = useRef<Partial<Record<Tool, HTMLButtonElement | null>>>({});
  const headingId = useId();
  const drawerId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `close` only reads refs and the current tool
  }, [open]);

  function close() {
    const tool = open;
    setOpen(null);
    if (tool) requestAnimationFrame(() => buttons.current[tool]?.focus());
  }

  const button = (tool: Tool, label: string, icon: ReactNode) => (
    <button
      ref={(el) => {
        buttons.current[tool] = el;
      }}
      type="button"
      aria-expanded={open === tool}
      aria-controls={drawerId}
      onClick={() => {
        if (tool === "explore") setExploreMounted(true);
        setOpen((current) => (current === tool ? null : tool));
      }}
      className={`inline-flex h-[30px] items-center gap-1.5 rounded-[4px] border px-2 text-[13px] ${
        open === tool ? "border-[#2a6496] bg-[#e8f0f8] text-[#1d4a70]" : "border-[#ccc] bg-white text-[#333] hover:bg-[#ebebeb]"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </button>
  );

  return (
    <>
      {button("sources", "Sources", <SourcesIcon />)}
      {explore ? button("explore", "Explore", <ExploreIcon />) : null}
      {open || exploreMounted ? (
        <aside
          id={drawerId}
          aria-labelledby={headingId}
          hidden={!open}
          className="fixed inset-x-0 bottom-0 z-40 flex max-h-[72dvh] flex-col border-t border-[#ccc] bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.15)] sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-[50px] sm:max-h-none sm:w-[400px] sm:border-l sm:border-t-0 sm:shadow-[-8px_0_24px_rgba(0,0,0,0.1)]"
        >
          <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3">
            <h2 id={headingId} className="m-0 text-[17px] font-semibold text-[#222]">
              {open === "sources" ? "Sources and assumptions" : "Explore this step"}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="rounded-[4px] border border-[#ccc] px-2 py-0.5 text-[13px] text-[#333] hover:bg-[#ebebeb]"
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {open === "sources" ? <SourcesPanel concept={concept} step={step} origin={origin} /> : null}
            {exploreMounted ? <div hidden={open !== "explore"}>{explore?.(step)}</div> : null}
          </div>
        </aside>
      ) : null}
    </>
  );
}

function SourcesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3 2.5h7l3 3v8H3z" strokeLinejoin="round" />
      <path d="M5.5 7.5h5M5.5 10h5" />
    </svg>
  );
}

function ExploreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}
