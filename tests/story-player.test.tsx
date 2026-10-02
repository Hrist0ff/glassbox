// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { StoryPlayer } from "@/components/story/StoryPlayer";
import { binarySearch } from "@/lib/fixtures/binary-search";
import { conceptToStory } from "@/lib/story/from-concept";

beforeAll(() => {
  // jsdom has no layout; give the stage a size so the SVG renders.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 1000, height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

describe("StoryPlayer with generated content", () => {
  it("renders hostile text as text, never as HTML", async () => {
    const hostile = structuredClone(binarySearch);
    hostile.title = '<img src=x onerror="alert(1)">';
    hostile.description = "<script>alert(1)</script> and *not emphasis* or [red|red]";
    hostile.steps[0]!.nodes[0]!.label = "<b>bold</b>";
    const { container } = render(<StoryPlayer story={conceptToStory(hostile, { subtitle: "AI-generated explanation" })} label="AI-generated" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent('<img src=x onerror="alert(1)">');
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    });
    // Plain captions: markup characters stay literal, with no emphasis or color applied.
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("<script>alert(1)</script> and *not emphasis* or [red|red]");
    expect(container.querySelector("img, script, b, em")).toBeNull();
  });
});
