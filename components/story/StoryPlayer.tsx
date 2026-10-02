"use client";

import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { captionText, parseCaption } from "@/lib/story/caption";
import { compileStory, worldAt } from "@/lib/story/engine";
import { INK } from "@/lib/story/palette";
import type { Beat, Story } from "@/lib/story/types";
import { setSpeed, SPEEDS, useSpeed, type Speed } from "./speed";
import { Stage } from "./Stage";
import { StoryNav } from "./StoryNav";

/**
 * Full-screen narrated player, modeled on "The Secret Lives of Data": one
 * sentence at a time at the bottom of the screen, a scene that animates while
 * it is read, and a Continue button once the scene has settled.
 *
 * → continues (or finishes the current animation), ← replays the previous
 * step. The chapter is kept in the URL hash so chapters can be linked.
 */

/** Distance between the stage edge and the drawing, as in the original. */
const PAD = 5;
/** Where reduced-motion mode draws a beat's messages along their path. */
const FROZEN_MESSAGE_AT = 0.6;

type Cursor = { index: number; epoch: number; skip: boolean };

export function StoryPlayer({
  story,
  label,
  embedded = false,
}: {
  story: Story;
  /** Short provenance shown in the top bar at all times, e.g. "AI-generated · not saved". */
  label?: string;
  /** Fill the parent box instead of the whole screen, e.g. on development pages. */
  embedded?: boolean;
}) {
  const compiled = useMemo(() => compileStory(story), [story]);
  const last = compiled.beats.length - 1;
  const reduced = useReducedMotion() ?? false;

  const [cursor, setCursor] = useState<Cursor>({ index: 0, epoch: 0, skip: false });
  // Elapsed time of the running beat, tagged with the epoch it belongs to so a
  // newly started beat never shows the previous beat's clock.
  const [frame, setFrame] = useState({ epoch: -1, t: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const speed = useSpeed();
  // Read by the animation loop, so changing speed mid-beat neither restarts nor jumps the scene.
  const rateRef = useRef<number>(SPEEDS[speed]);
  const continueRef = useRef<HTMLButtonElement>(null);
  const refocusContinue = useRef(false);
  // The hash is only written back after the chapter it names has been opened.
  const hashRead = useRef(false);

  const current = compiled.beats[cursor.index]!;
  const { beat } = current;
  const chapter = compiled.chapters[current.chapter]!;
  const t = cursor.skip || reduced ? current.end : frame.epoch === cursor.epoch ? frame.t : 0;
  const finished = t >= current.end;
  const world = useMemo(() => worldAt(current.start, current.items, t), [current, t]);

  const go = useCallback(
    (index: number) => setCursor((c) => ({ index: Math.max(0, Math.min(last, index)), epoch: c.epoch + 1, skip: false })),
    [last],
  );

  const forward = useCallback(() => {
    if (!finished) setCursor((c) => ({ ...c, skip: true }));
    else if (cursor.index < last) go(cursor.index + 1);
  }, [finished, cursor.index, last, go]);

  const back = useCallback(() => {
    let i = cursor.index - 1;
    while (i > 0 && compiled.beats[i]!.beat.next === "auto") i -= 1;
    if (i >= 0) go(i);
  }, [cursor.index, compiled, go]);

  useEffect(() => {
    rateRef.current = SPEEDS[speed];
  }, [speed]);

  // Animation clock for the current beat, in story time: it advances at the chosen speed.
  useEffect(() => {
    if (cursor.skip || reduced) return;
    const { end } = compiled.beats[cursor.index]!;
    let raf = 0;
    let last: number | null = null;
    let elapsed = 0;
    const tick = (now: number) => {
      if (last !== null) elapsed += (now - last) * rateRef.current;
      last = now;
      setFrame({ epoch: cursor.epoch, t: elapsed });
      if (elapsed < end) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cursor, reduced, compiled]);

  // Beats marked `auto` move on by themselves.
  useEffect(() => {
    if (!finished || beat.next !== "auto" || cursor.index >= last) return;
    const id = window.setTimeout(() => go(cursor.index + 1), reduced ? 600 : 0);
    return () => window.clearTimeout(id);
  }, [finished, beat.next, cursor.index, last, reduced, go]);

  // Stage size.
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Chapter links: open the chapter named in the hash, now and on later changes.
  useEffect(() => {
    const open = (hash: string) => {
      const id = decodeURIComponent(hash.replace(/^#/, ""));
      const target = compiled.chapters.find((c) => c.id === id);
      if (target) go(target.first);
    };
    const raf = requestAnimationFrame(() => {
      open(window.location.hash);
      hashRead.current = true;
    });
    const onHashChange = () => open(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [compiled, go]);

  // Mirror the current chapter in the hash without adding history entries.
  useEffect(() => {
    if (!hashRead.current) return;
    const url = new URL(window.location.href);
    const hash = current.chapter === 0 ? "" : `#${chapter.id}`;
    if (url.hash === hash) return;
    url.hash = hash;
    window.history.replaceState(window.history.state, "", url);
  }, [current.chapter, chapter.id]);

  // ← and → anywhere on the page, except while typing or with modifiers.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        forward();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [forward, back]);

  // Hidden buttons lose focus; give it back to Continue once it reappears.
  useEffect(() => {
    if (finished && refocusContinue.current) {
      refocusContinue.current = false;
      continueRef.current?.focus({ preventScroll: true });
    }
  }, [finished, cursor.epoch]);

  const controls = (
    <Controls
      visible={finished && beat.next !== "auto"}
      canBack={cursor.index > 0}
      atEnd={cursor.index === last}
      continueRef={continueRef}
      onBack={back}
      onContinue={() => {
        refocusContinue.current = true;
        forward();
      }}
      onRestart={() => go(0)}
    />
  );

  const announcement = beat.title
    ? [beat.title.heading, beat.title.sub].filter(Boolean).join(". ")
    : beat.plain
      ? (beat.say ?? "")
      : captionText(beat.say ?? "");

  return (
    <div className={`flex ${embedded ? "h-full" : "h-dvh"} flex-col overflow-hidden bg-white font-classic text-[14px] leading-[1.428] text-[#333]`}>
      <StoryNav>
        <div className="flex min-w-0 items-center gap-3">
          {label ? (
            <span className="truncate rounded-[3px] border border-[#ccc] bg-white px-2 py-0.5 text-[12px] text-[#555]">{label}</span>
          ) : null}
          {reduced ? null : <SpeedSelect speed={speed} />}
          <ChapterMenu chapters={compiled.chapters} active={current.chapter} onOpen={go} />
        </div>
      </StoryNav>

      <div ref={stageRef} className="relative mt-5 min-h-0 flex-1">
        {size.width > 0 && size.height > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            className="absolute inset-0 block"
            role="img"
            aria-label={`${story.title}: ${chapter.title}. ${announcement}`}
          >
            <g transform={`translate(${PAD},${PAD})`}>
              <Stage
                world={world}
                t={t}
                width={size.width - PAD * 2}
                height={size.height - PAD * 2}
                frozenMessagesAt={reduced ? FROZEN_MESSAGE_AT : undefined}
                rate={SPEEDS[speed]}
              />
            </g>
          </svg>
        ) : null}

        {beat.title ? (
          <div className="absolute inset-x-0 top-[40%] -translate-y-1/2 px-4 text-center">
            <div key={beat.title.heading} className="animate-story-fade">
              <h1 className="m-0 text-[30px] font-medium leading-[1.1] sm:text-[36px]">{beat.title.heading}</h1>
              {beat.title.sub ? <h2 className="mt-5 text-[22px] font-medium leading-[1.1] sm:text-[30px]">{beat.title.sub}</h2> : null}
            </div>
            <div className="mt-5">{controls}</div>
          </div>
        ) : null}
      </div>

      <div className="mx-auto flex min-h-[170px] w-full max-w-[1170px] shrink-0 flex-col items-center px-4 pb-4 pt-2.5 text-center">
        {beat.say ? <Caption key={beat.say} source={beat.say} plain={beat.plain ?? false} size={beat.size ?? "lg"} /> : null}
        {beat.links ? (
          <ul className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-1 text-[16px]">
            {beat.links.map((link) => (
              <li key={link.href}>
                <a href={link.href} target="_blank" rel="noreferrer" className="text-[#2a6496] hover:text-[#1d4a70] hover:underline">
                  {link.text}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {beat.title ? null : controls}
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function Caption({ source, plain, size }: { source: string; plain: boolean; size: NonNullable<Beat["size"]> }) {
  const Heading = size === "lg" ? "h2" : "h3";
  return (
    <Heading
      className={`m-0 mt-2.5 animate-story-fade font-medium leading-[1.15] ${
        size === "lg" ? "text-[21px] sm:text-[30px]" : "text-[18px] sm:text-[24px]"
      }`}
    >
      {(plain ? [{ kind: "text" as const, text: source }] : parseCaption(source)).map((segment, i) => {
        switch (segment.kind) {
          case "text":
            return <span key={i}>{segment.text}</span>;
          case "em":
            return <em key={i}>{segment.text}</em>;
          case "code":
            return (
              <code key={i} className="font-courier text-[0.92em]">
                {segment.text}
              </code>
            );
          case "ink":
            return (
              <span key={i} style={{ color: INK[segment.ink] }}>
                {segment.text}
              </span>
            );
        }
      })}
    </Heading>
  );
}

const BUTTON =
  "inline-flex h-[34px] items-center gap-1.5 border border-[#ccc] bg-white px-3 text-[14px] text-[#333] hover:border-[#adadad] hover:bg-[#ebebeb] focus-visible:border-[#adadad] focus-visible:bg-[#ebebeb] active:shadow-[inset_0_3px_5px_rgba(0,0,0,0.125)]";

function Controls({
  visible,
  canBack,
  atEnd,
  continueRef,
  onBack,
  onContinue,
  onRestart,
}: {
  visible: boolean;
  canBack: boolean;
  atEnd: boolean;
  continueRef: React.RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onContinue: () => void;
  onRestart: () => void;
}) {
  return (
    <div className={`mt-[14px] inline-flex ${visible ? "animate-story-fade" : "invisible"}`}>
      {canBack ? (
        <button type="button" onClick={onBack} aria-label="Replay previous step" title="Replay previous step (←)" className={`${BUTTON} rounded-l-[4px]`}>
          <ReplayIcon />
        </button>
      ) : null}
      {atEnd ? (
        <button type="button" onClick={onRestart} className={`${BUTTON} rounded-r-[4px] ${canBack ? "-ml-px" : "rounded-l-[4px]"}`}>
          Start over
        </button>
      ) : (
        <button
          ref={continueRef}
          type="button"
          onClick={onContinue}
          title="Continue (→)"
          className={`${BUTTON} rounded-r-[4px] ${canBack ? "-ml-px" : "rounded-l-[4px]"}`}
        >
          Continue <ChevronIcon />
        </button>
      )}
    </div>
  );
}

function SpeedSelect({ speed }: { speed: Speed }) {
  const id = useId();
  return (
    <span className="flex items-center gap-1.5">
      <label htmlFor={id} className="hidden text-[13px] text-[#666] sm:inline">
        Speed
      </label>
      <select
        id={id}
        value={speed}
        onChange={(event) => setSpeed(event.target.value as Speed)}
        aria-label="Animation speed"
        className="h-[30px] rounded-[4px] border border-[#ccc] bg-white px-1.5 text-[13px] text-[#333] focus-visible:border-[#66afe9]"
      >
        <option value="slow">Slow</option>
        <option value="normal">Normal</option>
        <option value="fast">Fast</option>
      </select>
    </span>
  );
}

function ChapterMenu({
  chapters,
  active,
  onOpen,
}: {
  chapters: { id: string; title: string; first: number }[];
  active: number;
  onOpen: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-3">
      <span className="hidden text-[14px] text-[#666] sm:inline">{chapters[active]?.title}</span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="rounded-[4px] border border-[#ddd] px-[10px] py-[9px] hover:bg-[#ddd] focus-visible:bg-[#ddd]"
      >
        <span className="sr-only">Chapters</span>
        <span aria-hidden className="block space-y-1">
          <span className="block h-[2px] w-[22px] rounded-[1px] bg-[#888]" />
          <span className="block h-[2px] w-[22px] rounded-[1px] bg-[#888]" />
          <span className="block h-[2px] w-[22px] rounded-[1px] bg-[#888]" />
        </span>
      </button>
      {open ? (
        <ul
          id={menuId}
          className="absolute right-0 top-full z-40 mt-[9px] min-w-[220px] rounded-[4px] border border-black/15 bg-white py-[5px] text-left shadow-[0_6px_12px_rgba(0,0,0,0.175)]"
        >
          {chapters.map((chapter, i) => (
            <li key={chapter.id}>
              <a
                href={`#${chapter.id}`}
                aria-current={i === active ? "true" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setOpen(false);
                  onOpen(chapter.first);
                }}
                className={`block whitespace-nowrap px-5 py-[3px] leading-[1.428] ${
                  i === active ? "bg-[#2a6496] text-white" : "text-[#333] hover:bg-[#f5f5f5] focus-visible:bg-[#f5f5f5]"
                }`}
              >
                {chapter.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReplayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M12.6 1.6v3.2H9.4" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 1.5 7.5 6 3 10.5" />
    </svg>
  );
}
