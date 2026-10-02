/**
 * Minimal stand-in for the OpenAI Responses API, for end-to-end tests of the
 * live generation path without paid calls. It is NOT used by the app at
 * runtime; point the app at it with OPENAI_BASE_URL=http://127.0.0.1:4010/v1.
 *
 *   npx tsx scripts/mock-openai.ts            # listens on :4010
 *
 * Scenarios are chosen by words in the topic:
 *   (default)       first draft fails validation, the repair passes review
 *   "always-reject" every review rejects the draft (3 attempts, nothing saved)
 *   "unsupported"   the planner declines the topic
 *   "slow"          the generator takes 20 s (for cancellation tests)
 *
 * GET /__calls returns the recorded calls; DELETE /__calls clears them.
 */
import { createServer, type IncomingMessage } from "node:http";
import { toGeneratedContent } from "../lib/concept/schema";
import { binarySearch } from "../lib/fixtures/binary-search";

const port = Number(process.env.MOCK_OPENAI_PORT ?? 4010);
/** Simulated model latency per call, so progress states are observable. */
const latencyMs = Number(process.env.MOCK_OPENAI_LATENCY_MS ?? 700);
const calls: Array<{ schema: string; topic: string; repair: boolean; strict: boolean; store: unknown }> = [];

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });

const topicOf = (input: string) => /<<<TOPIC\n([\s\S]*?)\nTOPIC>>>/.exec(input)?.[1] ?? "";

const plan = (topic: string) => ({
  status: topic.includes("unsupported") ? "unsupported" : "ok",
  limitation: topic.includes("unsupported") ? "This topic needs charts, which the player cannot draw. Try a protocol or algorithm instead." : null,
  concept: "Binary search",
  audience: "Curious beginners who can program",
  centralMechanism: "Repeatedly compare with the middle element of a sorted range and discard half.",
  scope: "Searching a sorted array; insertion and duplicates are left out.",
  prerequisites: ["Arrays and indices"],
  entities: [
    { id: "target", label: "Target", shape: "circle", role: "The value being searched for" },
    { id: "cell-0", label: "[0] 3", shape: "square", role: "Array element" },
  ],
  panels: [],
  storyboard: binarySearch.steps.map((step, i) => ({
    purpose: i === binarySearch.steps.length - 1 ? "takeaway" : i === 0 ? "example" : "mechanism",
    event: step.text,
    visualChange: "See scene",
  })),
  simplifications: ["Uses a seven-element array"],
  assumptions: ["The array is sorted ascending"],
  uncertainty: [],
});

const scenes = (repair: boolean) => {
  const { steps } = toGeneratedContent(binarySearch);
  if (!repair) {
    // A realistic first-draft mistake: an edge pointing at a node that is not in the step.
    steps[2] = { ...steps[2]!, edges: steps[2]!.edges.map((e) => ({ ...e, to: "cell-9" })) };
  }
  return { title: "Binary search (mock provider)", description: binarySearch.description, steps };
};

const review = (topic: string) =>
  topic.includes("always-reject")
    ? {
        passed: false,
        summary: "The comparison step is misleading.",
        issues: [
          {
            category: "technical_accuracy",
            severity: "major",
            stepId: "first-middle",
            problem: "The middle index is computed incorrectly.",
            suggestion: "Use (low + high) / 2 rounded down.",
          },
        ],
      }
    : { passed: true, summary: "Accurate and well paced.", issues: [] };

function responseFor(output: unknown) {
  return {
    id: `resp_${calls.length}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: "mock-model",
    status: "completed",
    output: [
      {
        type: "message",
        id: `msg_${calls.length}`,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(output), annotations: [] }],
      },
    ],
    usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 },
  };
}

// The scenario applies to the whole request, so remember it from the planner call.
let currentTopic = "";

createServer(async (req, res) => {
  if (req.url === "/__calls") {
    if (req.method === "DELETE") calls.length = 0;
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(calls));
    return;
  }
  if (req.method !== "POST" || !req.url?.endsWith("/responses")) {
    res.writeHead(404).end();
    return;
  }
  const body = JSON.parse(await readBody(req));
  const schema: string = body.text?.format?.name ?? "";
  const input: string = body.input ?? "";
  if (schema === "teaching_plan") currentTopic = topicOf(input).toLowerCase();
  const repair = input.includes("REQUIRED_FIXES");
  calls.push({ schema, topic: currentTopic, repair, strict: body.text?.format?.strict === true, store: body.store });

  let output: unknown;
  if (schema === "teaching_plan") output = plan(currentTopic);
  else if (schema === "concept_scenes") {
    if (currentTopic.includes("slow")) {
      const aborted = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 20_000);
        // The app aborts the call when its client disconnects; the socket then closes.
        res.on("close", () => {
          clearTimeout(timer);
          resolve(!res.writableEnded);
        });
      });
      if (aborted) return;
    }
    output = scenes(repair);
  } else if (schema === "concept_review") output = review(currentTopic);
  else {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "unknown schema" } }));
    return;
  }
  await new Promise((r) => setTimeout(r, latencyMs));
  if (res.destroyed) return;
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(responseFor(output)));
}).listen(port, "127.0.0.1", () => console.log(`mock OpenAI listening on http://127.0.0.1:${port}/v1`));
