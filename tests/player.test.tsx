// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InteractivePlayer } from "@/components/InteractivePlayer";
import { binarySearch } from "@/lib/fixtures/binary-search";
import { dnsResolution } from "@/lib/fixtures/dns";
import { raftLeaderElection } from "@/lib/fixtures/raft";

afterEach(cleanup);

const counter = (root: HTMLElement = document.body) => within(root).getByTestId("step-counter").textContent;
const stepText = (root: HTMLElement = document.body) => within(root).getByTestId("step-text").textContent;

describe("InteractivePlayer", () => {
  it("renders title, description, first step, and boundary states", () => {
    render(<InteractivePlayer concept={raftLeaderElection} />);
    expect(screen.getByRole("heading", { name: raftLeaderElection.title })).toBeInTheDocument();
    expect(screen.getByText(raftLeaderElection.description)).toBeInTheDocument();
    expect(counter()).toBe("Step 1 of 9");
    expect(stepText()).toBe(raftLeaderElection.steps[0]!.text);
    expect(screen.getByRole("button", { name: "Previous step" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Next step" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("button", { name: "Go to step 1" })).toHaveAttribute("aria-current", "step");
  });

  it("stays correct under rapid navigation and clamps at both ends", () => {
    render(<InteractivePlayer concept={raftLeaderElection} />);
    const next = screen.getByRole("button", { name: "Next step" });
    const previous = screen.getByRole("button", { name: "Previous step" });

    for (let i = 0; i < 25; i++) fireEvent.click(next);
    expect(counter()).toBe("Step 9 of 9");
    expect(next).toHaveAttribute("aria-disabled", "true");

    for (let i = 0; i < 3; i++) fireEvent.click(previous);
    expect(counter()).toBe("Step 6 of 9");

    // Interleaved bursts.
    for (let i = 0; i < 10; i++) {
      fireEvent.click(next);
      fireEvent.click(previous);
      fireEvent.click(next);
    }
    expect(counter()).toBe("Step 9 of 9");

    for (let i = 0; i < 25; i++) fireEvent.click(previous);
    expect(counter()).toBe("Step 1 of 9");
    expect(previous).toHaveAttribute("aria-disabled", "true");
  });

  it("restarts from the first step", () => {
    render(<InteractivePlayer concept={dnsResolution} initialStep={5} />);
    expect(counter()).toBe("Step 6 of 11");
    fireEvent.click(screen.getByRole("button", { name: "Restart from the first step" }));
    expect(counter()).toBe("Step 1 of 11");
  });

  it("clamps an out-of-range initial step", () => {
    render(<InteractivePlayer concept={dnsResolution} initialStep={99} />);
    expect(counter()).toBe("Step 11 of 11");
  });

  it("supports arrow keys but ignores them while typing or with modifiers", () => {
    render(
      <>
        <input aria-label="search" />
        <InteractivePlayer concept={raftLeaderElection} pageKeyboardShortcuts />
      </>,
    );
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "ArrowRight" });
    });
    expect(counter()).toBe("Step 3 of 9");

    const input = screen.getByRole("textbox", { name: "search" });
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowRight" });
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(counter()).toBe("Step 3 of 9");

    fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true });
    expect(counter()).toBe("Step 3 of 9");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(counter()).toBe("Step 2 of 9");
  });

  it("handles keys inside the player when page shortcuts are off", () => {
    render(<InteractivePlayer concept={binarySearch} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("Step 1 of 8");
    fireEvent.keyDown(screen.getByRole("button", { name: "Next step" }), { key: "ArrowRight" });
    expect(counter()).toBe("Step 2 of 8");
  });

  it("announces the current step and describes the scene in text", () => {
    render(<InteractivePlayer concept={raftLeaderElection} initialStep={3} />);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe(`Step 4 of 9. ${raftLeaderElection.steps[3]!.text}`);
    expect(screen.getByRole("img", { name: "Diagram for step 4 of 9" })).toHaveAccessibleDescription(/S3 candidate \(term 2\)/);
    expect(screen.getByTestId("what-changed")).toHaveTextContent("RequestVote (term 2)");
  });

  it("renders one node and edge per entity with stable ids", () => {
    const { container } = render(<InteractivePlayer concept={raftLeaderElection} initialStep={3} />);
    const nodes = [...container.querySelectorAll("[data-node-id]")].map((n) => n.getAttribute("data-node-id"));
    const edges = [...container.querySelectorAll("[data-edge-id]")].map((n) => n.getAttribute("data-edge-id"));
    expect(nodes.sort()).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(edges.sort()).toEqual(["rv1", "rv2", "rv4", "rv5"]);
  });

  it("gives each player instance its own SVG marker ids", () => {
    const { container } = render(
      <>
        <InteractivePlayer concept={raftLeaderElection} initialStep={3} />
        <InteractivePlayer concept={dnsResolution} initialStep={1} />
      </>,
    );
    const ids = [...container.querySelectorAll("marker")].map((m) => m.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const path of container.querySelectorAll("path[marker-end]")) {
      const ref = path.getAttribute("marker-end")!.match(/^url\(#(.+)\)$/)![1]!;
      const marker = container.querySelector(`marker#${CSS.escape(ref)}`);
      expect(marker).not.toBeNull();
      // The marker must belong to the same player's SVG.
      expect(marker!.closest("svg")).toBe(path.closest("svg"));
    }
  });

  it("renders generated text as text, never as markup", () => {
    const hostile = structuredClone(binarySearch);
    hostile.title = '<img src=x onerror="alert(1)">';
    hostile.steps[0]!.text = "<script>alert(1)</script>";
    hostile.steps[0]!.nodes[0]!.label = "<b>bold</b>";
    const { container } = render(<InteractivePlayer concept={hostile} />);
    expect(container.querySelector("img, script, b")).toBeNull();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent('<img src=x onerror="alert(1)">');
  });
});
