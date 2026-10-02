/**
 * Minimal stand-in for the OpenAI Responses API, for end-to-end tests of the
 * live generation path without paid calls. It is NOT used by the app at
 * runtime; point the app at it with OPENAI_BASE_URL=http://127.0.0.1:4010/v1.
 *
 *   npx tsx scripts/mock-openai.ts            # listens on :4010
 *
 * Scenarios are chosen by words in the topic (never in pasted material):
 *   (default)       first draft fails validation, the repair passes review
 *   "always-reject" every review rejects the draft (3 attempts, nothing saved)
 *   "unsupported"   the planner declines the topic and suggests alternatives
 *   "slow"          the generator takes 20 s (for cancellation tests)
 * Pasted material gets claims whose excerpts are copied from its passages,
 * plus one claim with an invented excerpt, which the server must downgrade.
 *
 * GET /__calls returns the recorded calls; DELETE /__calls clears them.
 */
import { createServer, type IncomingMessage } from "node:http";
import { toGeneratedContent } from "../lib/concept/layout";
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
/** Passages of pasted material: "[p1] text" paragraphs inside the SOURCE block. */
const passagesOf = (input: string) =>
  [...(/<<<SOURCE\n([\s\S]*?)\nSOURCE>>>/.exec(input)?.[1] ?? "").matchAll(/\[(p\d+)\] ([^\n]+)/g)].map((m) => ({ id: m[1]!, text: m[2]! }));

const claims = (input: string) => {
  const passages = passagesOf(input);
  return {
    status: "ok",
    limitation: null,
    title: "Mock material",
    summary: "Material supplied for a test.",
    claims: [
      ...passages.slice(0, 2).map((p, i) => ({ id: `c${i + 1}`, text: `The material says: ${p.text.slice(0, 80)}`, basis: "source", passages: [p.id], quote: p.text.slice(0, 60) })),
      // An excerpt that is not in the material: the server must not keep it as "stated in the source".
      { id: "c9", text: "An invented statement.", basis: "source", passages: [passages[0]?.id ?? "p1"], quote: "words that appear nowhere in the material" },
    ],
    conflicts: [],
    gaps: ["The material does not say when the labels were finished."],
    embeddedInstructions: false,
    language: "English",
  };
};

const plan = (topic: string, source: boolean) => ({
  status: topic.includes("unsupported") ? "unsupported" : "ok",
  limitation: topic.includes("unsupported") ? "This topic needs a plot of a continuous function, which the player cannot draw." : null,
  alternatives: topic.includes("unsupported") ? ["How binary search works", "Compound interest over 30 years"] : [],
  concept: "Binary search",
  learningGoal: "See how comparing with the middle element halves the range at every step.",
  explanationType: "mechanism",
  representation: "actors_and_messages",
  representationReason: "The target and the array cells are entities, and each comparison is a visible event.",
  layout: "flow",
  audience: "Curious beginners who can program",
  language: "English",
  depth: "standard",
  scope: "Searching a sorted array; insertion and duplicates are left out.",
  omissions: ["Duplicates", "Insertion"],
  prerequisites: ["Arrays and indices"],
  centralIdea: "Repeatedly compare with the middle element of a sorted range and discard half.",
  essentials: ["Each comparison halves the range, so the search takes about log2(n) steps."],
  entities: [
    { id: "target", label: "Target", shape: "circle", role: "The value being searched for" },
    { id: "cell-0", label: "[0] 3", shape: "square", role: "Array element" },
  ],
  panels: [],
  beats: binarySearch.steps.map((step, i) => ({
    purpose: i === binarySearch.steps.length - 1 ? "summary" : i === 0 ? "example" : "mechanism",
    before: "The previous scene",
    event: step.text,
    after: "The scene after this step",
    why: "Each comparison discards about half of the range.",
    connection: i === 0 ? "none" : "sequence",
    claims: source && i < binarySearch.steps.length - 1 ? ["c1"] : [],
  })),
  simplifications: ["Uses a seven-element array"],
  assumptions: [{ id: "a1", text: "The array is sorted ascending" }],
  uncertainty: [],
});

const scenes = (repair: boolean, source: boolean) => {
  const { steps } = toGeneratedContent(binarySearch);
  if (!repair) {
    // A realistic first-draft mistake: an edge pointing at a node that is not in the step.
    steps[2] = { ...steps[2]!, edges: steps[2]!.edges.map((e) => ({ ...e, to: "cell-9" })) };
  }
  if (source) steps[0] = { ...steps[0]!, claims: ["c1"] };
  return { title: source ? "Your material (mock provider)" : "Binary search (mock provider)", description: binarySearch.description, steps };
};

const stepText = () => ({
  status: "ok",
  limitation: null,
  text: "The search compares the target with the middle element. Because the array is sorted, one comparison rules out half of the remaining range.",
  claims: [],
});

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

// The scenario applies to the whole request, so remember it from the first call.
let currentTopic = "";
let currentSource = false;

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
  if (schema === "source_claims") {
    // Scenario words apply to topics only: pasted material may contain them by chance ("slower").
    currentSource = true;
    currentTopic = "";
  } else if (schema === "teaching_plan" && !currentSource) currentTopic = topicOf(input).toLowerCase();
  else if (schema === "step_text") currentTopic = "";
  const repair = input.includes("REQUIRED_FIXES");
  calls.push({ schema, topic: currentTopic, repair, strict: body.text?.format?.strict === true, store: body.store });

  let output: unknown;
  if (schema === "source_claims") output = claims(input);
  else if (schema === "teaching_plan") output = plan(currentTopic, currentSource);
  else if (schema === "step_text") output = stepText();
  else if (schema === "step_text_review") output = review("");
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
    output = scenes(repair, currentSource);
  } else if (schema === "concept_review") {
    output = review(currentTopic);
    // The request is over once its review is in.
    currentSource = false;
  }
  else {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "unknown schema" } }));
    return;
  }
  await new Promise((r) => setTimeout(r, latencyMs));
  if (res.destroyed) return;
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(responseFor(output)));
}).listen(port, "127.0.0.1", () => console.log(`mock OpenAI listening on http://127.0.0.1:${port}/v1`));
