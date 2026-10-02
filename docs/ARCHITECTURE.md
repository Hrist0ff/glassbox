# Glassbox architecture

How Glassbox turns a topic, or material a reader pastes, into a narrated, animated explanation, and how the pieces fit together. For setup and usage, see the [README](../README.md).

```
topic ─────────────┐
                   ├─► POST /api/generate ─► [reader] ─► planner ─► generator ─► layout ─► checks ─► reviewer ─► completed event
pasted material ───┘   (limits, SSE)          (AI:      (AI)        (AI, strict   (code)    (code)     (AI)        carries the concept
                                              claims +              JSON, no            │          │                 │
                                              checked               coordinates)        └─errors───┴─issues─┐        ▼
                                              excerpts)                 ▲                                    │   browser saves it
                                                                        └────────── repair (≤ 3 drafts) ◄────┘   in localStorage
                                                                                                                      │
/concept/<id>: concept ──► relayout for portrait screens (lib/concept/layout.ts) ──► lib/story/from-concept.ts ──► story player
                                                                                                    │
                     Sources drawer (evidence for the step) ◄───────────────────────────────────────┤
                     Explore drawer: explain / simplify / another example ──► POST /api/generate ───┘ (kind "explore")
```

- **The AI writes data, never code or coordinates.** The generator returns JSON that must match one Zod schema (`lib/concept/schema.ts`). It places nodes on a grid; application code computes every position and draws everything.
- **Planning starts from the goal.** The planner states what the reader should understand, classifies the explanation (mechanism, chronology, comparison, hierarchy, decision, quantitative), and only then picks a representation: actors and messages, a code trace, changing data, a timeline, a comparison, a hierarchy, or a chart.
- **Supplied material is evidence, not instructions.** Claims are extracted with verbatim excerpts, and every excerpt is checked by code before anything cites it. Contradictions and gaps are recorded and shown.
- **Nothing is stored on the server.** A finished explanation travels back in the stream; the browser saves it in its own library (localStorage).
- **One player for everything.** Generated explanations, bundled examples, and the hand-written `/learn` stories all play in the same story player (`components/story/`).

---

## Code map

```
app/
  page.tsx                          Home: two entry paths (topic, your material), gallery, "how it works"
  api/generate/route.ts             POST JSON → SSE stream; request kinds, limits, rate limit, pipeline, completed event
  concept/[id]/page.tsx             An explanation saved in this browser (read from localStorage)
  concept/[id]/example/[sid]/       Another example made for one of its steps
  demo/[slug]/                      A bundled example
  learn/, learn/[slug]/             Hand-written stories (HTTP, Kafka)
  dev/evals/                        Prompt-evaluation results (development only)
components/
  TopicForm.tsx                     "Explain a topic" / "Visualize my information", options (audience, language, depth)
  GenerationLoader.tsx              Streaming progress UI and the request hook
  SavedExplanation.tsx              Plays a saved explanation or example, with its step tools
  story/StoryPlayer.tsx             Full-screen player: captions, Continue/replay, keys, speed, chapters, a11y, portrait switch
  story/Stage.tsx                   SVG renderer for one moment of a story
  story/PanelMark.tsx               Panel dispatcher; panels/ holds one renderer per representation
  story/StepTools.tsx               Top-bar buttons and the drawer for step tools
  story/SourcesPanel.tsx            "Sources and assumptions": evidence for the current step, scope, omissions, limits
  story/ExplorePanel.tsx            "Explore this step": explain, simplify, another example
lib/
  concept/                          Scene contract: constants, schema (+ migration), frames, layout engine, geometry, validator
  sources/passages.ts               Pasted material → passages with stable ids; excerpt matching
  generation/request.ts             Request kinds, preferences, per-kind body limits
  pipeline/                         Roles (prompts), orchestrator, OpenAI client, budget, demo pipeline
  story/                            Story format, timeline engine, renderer geometry, converter, linter, DSL
  stories/                          Hand-written stories
  generation/                       Stream lifecycle, client consumer, rate limiter, client key
  sse/                              Event contract (Zod) and a chunk-safe SSE parser
  library.ts                        The browser library and step supplements (localStorage), with migration
  fixtures/                         Bundled examples (three version-1, four laid out by the layout engine)
  evals/                            Eval run types, loader, and the independent grader
scripts/                            mock-openai (tests), smoke-live and eval-prompts (real API)
tests/                              Unit (Vitest) and browser (Playwright) tests
evals/topics.json, evals/sources/   Prompt-evaluation cases and the material they use
```

Stack: Next.js 16 App Router (Turbopack), React 19, TypeScript (strict, `noUncheckedIndexedAccess`), Tailwind CSS 4, Zod 4, and the official OpenAI SDK. No database, no accounts, no agent framework.

---

## The scene contract (`lib/concept`)

One canonical Zod schema defines an explanation (a "concept"). TypeScript types are inferred from it, and the same definitions are used for AI structured output, validation, the browser library, and fixtures. Limits, enums, and sizes live in `constants.ts` only; prompts, the validator, the layout engine, and the renderer read them from there.

```ts
Concept    { schemaVersion: 2, id: uuid, title, description, steps: Step[2..12],
             layout?: flow|ring|code_beside_data|timeline|comparison|hierarchy|chart,
             provenance?: Provenance }
Step       { id, text /* ≤ 20 words */, notes?, nodes: VisualNode[0..8], edges: VisualEdge[0..12],
             panels?: Panel[0..3], focus?: id[1..4], timing?: changes_first|messages_first, claims?: id[1..4] }
VisualNode { id, label /* ≤ 30 chars */, x, y, col?, row? /* grid cell it was placed from */, shape, color: <token>, status }
VisualEdge { id, from, to /* node or panel */, label, animated: boolean, order?: 1..4 }
Panel      = log | code | table                        (as in version 1)
           | timeline   { items: { text, tag /* date as written */, id?, lane?, at?, end?, date?: exact|approximate|unknown|none }[0..10],
                          lanes?: string[0..4], spacing?: ordered|proportional, unit?, relations?: { from, to, type: causes|enables|responds_to }[] }
           | comparison { alternatives: string[2..4], criteria: { id, label, unit, cells: { text, missing: unknown|not_applicable|null }[] }[0..6] }
           | hierarchy  { style: tree|groups, relation: part_of|kind_of|reports_to|member_of,
                          items: { id, text, parent|null }[1..12] /* ≤ 6 levels */, links: { from, to, type: depends_on|uses|related_to }[] }
           | chart      { chart: bar|line, data: observed|illustrative, categories: string[2..8], xLabel, yLabel, unit,
                          series: { name, color, values: (number|null)[] }[1..3], revealed, highlight|null }
Provenance { request: { kind: topic|source|example, topic, question, audience, language, depth },
             learningGoal, explanationType, representation, sourcesConsulted,
             sources: { id, kind: pasted_text, title, passages: { id, text }[] }[0..1],
             claims: { id, text, basis: source|interpretation|assumption, passages, quote }[],
             scope, omissions, simplifications, uncertainty, limitations }
```

- **Each step is a complete snapshot.** The AI describes what each step looks like; code decides how to animate between them.
- **Colors are semantic tokens:** neutral, primary (what the step is about), secondary, success, warning, danger. Comparisons have no score or winner field, and color never marks a "better" option.
- **Messages travel in rounds.** An animated edge with `order` 2 starts when round 1 has arrived, so a reply can follow its request in one step.
- **Timing** (the one contract, stated identically to the planner, generator, and reviewer, and implemented by the converter): `changes_first` (default): the scene changes, then messages travel; a receiver shows a message's effect only in a later step. `messages_first`: every round of messages travels, then all of the step's changes appear together. Nothing changes between rounds.
- **Static views are valid.** A comparison or chart can be complete in two steps; a step may change only a highlight or the camera focus, and a final summary may hold the previous scene.
- **Wire format.** OpenAI's strict mode requires every key, so the generator's schema (`GeneratedConceptContentSchema`) makes optional fields required and nullable, and has **no coordinates**: nodes carry `col` and `row`, panels no position. The layout engine produces the canonical, positioned concept. Converting drops what cannot apply (a time position on an undated event).
- **Identity and provenance** are application-owned: the model never writes `id`, `schemaVersion`, `layout`, or `provenance`.

### Versioning and migration

`schemaVersion` 2 only adds optional fields, so `migrateConcept` upgrades a version-1 concept by changing its number; `validateConcept` migrates before parsing. All 88 recorded version-1 eval outputs and the version-1 fixtures still validate and play.

Rules added with version 2 apply only to what version 1 could not contain (version-2 timelines, the new panels, provenance, laid-out concepts; label widths count wide characters only for laid-out concepts), so explanations saved before this release stay valid. **A new validation rule must not invalidate stored explanations**: scope it to content that could not exist before, or to a new version.

The browser library's container is version 2; version-1 libraries are read and migrated. Writes never destroy data this code cannot read: entries that fail validation are kept as they are, and a library or supplement store written by an unknown newer version is not overwritten (saving returns "blocked" and the result stays available for the visit).

### Frames (`frames.ts`)

A panel appears in several steps with different content (a timeline grows, a comparison reveals rows, a chart reveals values). Its **frame** is built from the union of that content: size, lanes, slot or time positions, rows, tree boxes, and chart axis. The frame never changes between steps, so nothing jumps; the layout engine reserves its size, the validator checks it, and the renderer draws inside it. Frames depend on the arena's orientation: on the portrait arena, timelines run downward, trees become outlines, comparisons and charts use narrower columns. On the landscape arena, timeline slots narrow so lane names and ten events fit, and trees too wide or too deep to fit become indented outlines (real nesting is kept, never flattened). Hierarchies with cross-links keep a gutter on the right; links between items in the same column are routed through it, and links are drawn over the boxes so none hides.

### Layout engine (`layout.ts`)

The generator says where things belong; the engine computes positions:

- **Nodes**: grid cells (`flow`: columns in the order a request moves, rows for parallel entities) or ring order (`ring`). Positions depend only on the cell, so an entity keeps its place across steps unless the explanation moves it on purpose. Unused rows and columns are compacted. When a connection would pass through another node, that node's cell is moved away from the line, perpendicular to it and just far enough, for a few rounds (one move can create another crossing). Each arrangement is also scored without these moves, so they can never make a layout worse.
- **Panels**: sized from their frames for everything they will ever show. Panels that never share a step share a slot.
- **Arrangements**: nodes above, below, left, or right of the panels; panels side by side or stacked. Each strategy has a preference order; the arrangement with the fewest geometry errors, then the most room, wins.
- **Portrait relayout** (`relayout`): at render time, a laid-out concept is placed again on a 600 × 1000 arena. If the result has any geometry error, the player keeps the stored landscape layout.

The validator remains the final check of every layout.

### Arena and geometry (`constants.ts`, `geometry.ts`)

| | |
| --- | --- |
| Arenas | Landscape 1000 × 600 (stored), portrait 600 × 1000 (render-time relayout). Origin top-left. |
| Nodes | Radius 32 (squares 64 × 64). Labels below the node in up to two lines; East Asian wide characters count double in width estimates. |
| Minimum separation | 88 units between node centers. |
| Panels | Sizes from `panelSize` (log, code, table, version-1 timeline) and frames (the rest), with constants in `PANEL`. The validator and the renderer use the same functions. |

### Validation (`validate.ts`)

Pure functions return structured issues (`code`, `severity`, `message`, `path`, `stepId`). **Errors** send a draft back to the generator; **warnings** go to the reviewer for context.

- Errors: payload size; schema; step text over 20 words; duplicate ids; edge endpoints that are not a node or panel in the step; self-edges and duplicate connections; nodes, labels, or panels outside the arena; nodes too close (with the grid cell when two share one); an edge through another node; panels covering a node, label, or another panel; table shape and cell length; focus on something not in the step; an empty scene; a renamed entity or a reused edge id; a panel changing kind.
- Representation errors: timelines out of chronological order, events in unknown lanes, missing dates (unless explicitly unknown, or `none` for undated stages), a date or time written into an event's text while its date is marked unknown or none, ends before starts, proportional spacing without known times or with same-lane events too close to label, relations to unknown events; text cut off mid-word ("transport-", "no delivery/"; a path like "src/" is fine) in timelines, comparisons, hierarchies, and chart categories; unevenly spaced points in time on a line chart (they are drawn evenly); comparisons with the wrong number of cells, empty values without a missing mark, or alternatives that change between steps; hierarchies with unknown parents, cycles, no root, too much depth (groups: one level); charts with the wrong number of values, no values, categories that change, or out-of-range reveal or highlight.
- Provenance errors: steps citing unknown claims; `sourcesConsulted` inconsistent with attached sources; claims citing unknown passages; **a claim marked as stated in the source whose excerpt is not found in its passage** (re-checked on every read, so edited storage cannot fake evidence); assumptions citing passages.
- Warnings: estimated label overlaps, a node changing shape, an unchanged scene (except a final summary), gaps between message rounds, `messages_first` without messages, `order` on a non-message edge.

Geometry checks use estimated text widths, so they catch clear problems but cannot prove a scene is readable or correct.

---

## The story player (`lib/story`, `components/story`)

Modeled on [The Secret Lives of Data](https://github.com/benbjohnson/thesecretlivesofdata): one sentence at a time at the bottom of a full-screen stage, a scene that animates while it is read, and Continue once it settles.

- **Story format** (`types.ts`). Chapters of beats; a beat has a caption (or a title card) and a timed script: `add`, `remove`, `set`, `append`, `cell`, `truncate`, `cells`, `send`, `zoom`, `timer`. `cells` replaces a panel's keyed cells: items already shown keep their age, new ones fade in. Beats converted from a concept carry the `step` they belong to. Colors are tokens (`palette.ts`). Generated captions are `plain: true`.
- **Engine** (`engine.ts`). A beat's script is flattened into timed actions; the scene at time `t` is a pure function of the starting snapshot and the actions due by `t`.
- **Renderer** (`Stage.tsx`, `PanelMark.tsx`, `panels/`). SVG. Panels are drawn at one scale on both axes inside the box the validator measured. Timelines show their spacing ("In order · not to scale" or "To scale · unit"), lanes, durations, and only stated relations (gray dashed arcs, never messages). Comparisons mark unknown and not-applicable values on hatched cells. Hierarchies name their relation in a legend. Charts reveal values on a fixed axis, mark missing values as "no data", and say where their numbers come from ("Illustrative numbers…", "Figures from the supplied material", or "…from the AI model's general knowledge, not checked against a source").
- **Converter** (`from-concept.ts`). Turns a concept into a story: what disappears goes first, nodes glide and recolor, panels update in place (keyed panels swap cells), new things appear, lines connect, then messages travel in rounds (or, for `messages_first`, messages first and every change after the last arrival). In laid-out explanations, a step with panels and no nodes zooms onto its panels. `conceptStories` returns the landscape story and, when the relayout succeeds, a portrait story with identical beats.
- **Player** (`StoryPlayer.tsx`). Uses the portrait story when the stage is narrower than 0.8 × its height, keeping the reader's place (the URL hash is read only on arrival and on hash changes). An open side drawer narrows the stage instead of covering it. → continues, ← replays; chapters in the URL hash; speed Slow / Normal / Fast; reduced motion shows each step finished (read only after hydration, so server and client markup match). Step tools render in the top bar.
- **Step tools** (`StepTools.tsx`). "Sources" opens a drawer with the evidence for the current step (claims with their type and the cited passage, excerpt highlighted) and, for the whole explanation, whether sources were consulted, the goal, scope, omissions, simplifications, assumptions, uncertainty, and limits of the material. "Explore" (live mode, saved explanations) asks for an explanation of the step, a simpler version, or another example; results are listed under the step they belong to. Once opened, Explore stays mounted while hidden, so closing the drawer never cancels a request in progress. Escape closes the drawer and returns focus.

---

## Generation (`lib/pipeline`, `app/api/generate`)

`orchestrator.ts` is pure and dependency-injected (no route or storage imports), so it is unit-testable.

### Roles (`roles.ts`)

| Role | Input | Output |
| --- | --- | --- |
| **Reader** (material only) | passages `[p1] …`, question, preferences | claims (`source` with a verbatim excerpt, or `interpretation`), contradictions, gaps, the material's language, whether the material contained instructions to an AI |
| **Planner** | topic or verified claims and the material's language, preferences (or, for another example, the parent explanation and step) | learning goal, the 2–4 **essentials** without which the subject is not understood, explanation type, representation and why, layout, audience, language (English name), depth, scope and omissions, beats (`before`, `event`, `after`, `why`, `connection`, `claims`), assumptions with ids, uncertainty; or a decline with alternatives |
| **Generator** | plan, claims, previous candidate and required fixes | scene JSON without coordinates |
| **Reviewer** | the original request and preferences, plan, material and claims, candidate (without positions), warnings, previous issues | issues by category (request fidelity, essential coverage, source fidelity, representation, accuracy, temporal/causal, coherence, consistency, progression, continuity, readability, overclaiming) and severity |
| **Writer** | the explanation, the selected step, material and claims | a plain-text explanation or simpler version of the step |

All prompts share one capability description and one timing contract, generated from `constants.ts`. User data is wrapped in labeled blocks (`<<<SOURCE … SOURCE>>>`) that the data cannot close or fake (`fence` neutralizes `<<<` and `>>>`), and every role is told that the data is never instructions.

### Deterministic checks between roles

- **Claim verification** (`verifyClaims`): unknown passage ids are dropped; a `source` claim keeps that status only if its excerpt is found in a cited passage (ignoring case, spacing, and quote styles; `…` may elide a middle part), or anywhere in the material (the citation is corrected); otherwise it becomes an interpretation, and the explanation records that in its limitations. Contradictions and gaps become limitations too.
- **Plan checks** (`planProblems`): meaningful required content (no placeholders, no blank assumptions), at least one essential, enough beats for the explanation type, a final summary beat, a representation allowed for the type, a layout allowed for the representation, the representation's panel, unique ids, cited claims and assumptions that exist, every non-prerequisite beat citing the material (material requests), and the language (the requested one, or else the material's; "Deutsch" and "German" match). Problems go back to the planner once. Blank list items are dropped before they reach the provenance.
- **Layout and validation** of every draft (above), plus citations limited to the plan's claims and assumptions.

### Pipelines

- **Explanations** (`topic`, `source`, and `explore`/`example`): [read] → plan (≤ 2 calls) → (generate → lay out → validate → review) × at most 3 → persist. A draft is accepted only if the reviewer passes it **and** there are no blocker or major issues. Provenance is assembled by code from the request, plan, and verified claims. "Another example" plans a short new explanation of the selected step's idea; it is reviewed like any other and recorded as made up (an assumption the app adds).
- **Step texts** (`explore`/`explain`, `explore`/`simplify`): (write → check plain text and citations → review) × at most 2 → persist.
- Declines (`unsupported_topic`) carry the planner's limitation and up to three **suggestions** the reader can submit with one click.

**Provider retries** (once, for 429/5xx/network) are separate from repair attempts. Refusals, truncation, invalid JSON, timeouts, cancellation, and HTTP errors each map to a typed error; users never see provider error text.

### Time budget

| Setting | Value |
| --- | --- |
| `maxDuration` | 300 s (Node.js runtime) |
| Server deadline | `GENERATION_DEADLINE_MS`, default 270 s (≤ 290 s); aborts all work |
| Per-call timeouts | reader 70 s, planner 90 s, generator 110 s, writer 45 s, reviewer 60 s, capped by the time left |
| Output caps | reader 10k, planner 10k, generator 24k, writer 4k, reviewer 8k tokens |
| New attempts | Start only if a minimal generate + review still fits |

### POST /api/generate

Requests, as `application/json`:

| Kind | Body | Limit |
| --- | --- | --- |
| Topic | `{ topic, preferences?, idempotencyKey }` (`kind: "topic"` optional) | 2 KB |
| Material | `{ kind: "source", text /* ≤ 16,000 chars */, title?, question?, preferences?, idempotencyKey }` | 72 KB |
| Explore | `{ kind: "explore", action: explain\|simplify\|example, stepId, topic, concept, idempotencyKey }` | 240 KB |

`preferences` is `{ audience?, language?, depth?: overview|standard|detailed }`. The explanation sent for exploring is validated like stored data (including the excerpt checks) before use. Demo mode serves topic requests only (`demo_mode` error otherwise).

Checks before streaming (plain JSON errors): same-origin `Origin`, exact `application/json`, body size by kind, schema, text limits, mode, and the rate limit (`Retry-After` on 409/429). Explore requests count against the same per-visitor limit.

Stream: `text/event-stream`, every event with `requestId` and an increasing `seq`.

| Event | Meaning |
| --- | --- |
| `started` | mode (`live` or `demo`), a label for the request, maximum attempts |
| `progress` | stage (`access`, `read`, `plan`, `generate`, `validate`, `evaluate`, `persist`), state, message, attempt |
| `attempt` | attempt n: started, rejected (with reasons), or accepted |
| `completed` | `conceptId`, `url`, and either the validated `concept` or, for explore requests, a `supplement` (text, or an example concept) |
| `failed` | code, message, `retryable`, reasons, `suggestions` |

Heartbeats every 15 s; exactly one terminal event per stream; free text clipped to wire limits. Closing the connection cancels the pipeline and any in-flight OpenAI call.

### Rate limiting

`lib/generation/memory-slots.ts`: per visitor, at most `RATE_LIMIT_PER_CLIENT_PER_HOUR` generations per rolling hour and one at a time; site-wide, `RATE_LIMIT_GLOBAL_PER_HOUR`. A visitor is an HMAC of the client IP with a random per-process secret. The state is in server memory: it resets on restart and, on serverless platforms, applies per instance.

### Demo mode

Without `OPENAI_API_KEY` (or with `GENERATION_MODE=demo`), topic requests are matched to a bundled example by keyword and validated; the "Visualize my information" path and Explore are not offered.

---

## The browser library (`lib/library.ts`)

- `glassbox:library` (version 2): saved explanations, newest first, de-duplicated by id. Each concept carries its provenance, including the pasted material, so the Sources view and Explore work later.
- `glassbox:supplements` (version 1): explanations, simpler versions, and examples for steps, keyed by explanation and step id; deleted with their explanation.
- Every read validates each entry again (examples like any explanation) and skips anything invalid. If storage is full or blocked, results open for the current visit and are labeled "not saved".
- Links to `/concept/<id>` work only in the browser that saved the explanation. `glassbox:story-speed` keeps the speed setting.

---

## Testing

| Command | What it covers |
| --- | --- |
| `npm run check` | Typecheck, lint, unit tests, and a production build |
| `npm test` | Schema, migration, validator (panels, representations, provenance), frames, the layout engine (random grids on both arenas, slot sharing, portrait fallback), passages and excerpt matching, claim verification, prompt fencing, request parsing, plan checks, the prompt contract (timing, holds, repairs, code text), the orchestrator (attempt cap, repair, plan repair, material, exploring, errors, deadline), the converter on every fixture and recorded eval concept, the story engine and linter, SSE, the stream lifecycle, the client, the rate limiter, and the browser library (migration, supplements) |
| `npm run e2e` | Playwright against a running demo-mode app: the player (keys, chapters, speed, motion, reduced motion without hydration errors, focus, phone layout), each representation, the Sources drawer, portrait relayout on a phone, demo generation, API errors and limits, and accessibility (axe) |
| `E2E_LIVE_BASE_URL=… npm run e2e` | Also the live path with a **mocked** OpenAI: repair, saving, reopening, deletion, rejection, declines with alternatives, cancellation, pasted material with evidence, and exploring a step |
| `npm run eval:prompts` | **Real API.** Runs `evals/topics.json` through the pipeline, checks results deterministically, grades them independently, and writes a report to `evals/runs/` |
| `npm run smoke:live -- "topic"` (or `-- --file path "title"`) | **Real API.** Runs the pipeline once and prints progress |

Live-mode browser tests, locally:

```bash
npm run build
npm run mock:openai &                                         # mock OpenAI on :4010
GENERATION_MODE=live OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=http://127.0.0.1:4010/v1 \
  RATE_LIMIT_PER_CLIENT_PER_HOUR=50 npx next start -p 3100 &
GENERATION_MODE=demo npx next start -p 3101 &                 # demo-mode server
E2E_BASE_URL=http://localhost:3101 E2E_LIVE_BASE_URL=http://localhost:3100 npm run e2e   # PW_CHANNEL=chrome for installed Chrome
```

### Improving the prompts

Prompts live in `lib/pipeline/roles.ts`. Measure a change with `npm run eval:prompts -- --label <name> --repeat 2` and compare reports in `evals/runs/`; browse the results in the real player at `/dev/evals` while `npm run dev` runs. Results of the runs for this release are summarized in [EVALS.md](EVALS.md).

The eval set covers technical flows and algorithms, historical chronology, parallel project and incident events, comparisons, hierarchies, numbers, pasted material with contradictions, gaps, ambiguity, and embedded instructions, language and audience preferences, and requests that should be declined. Each run records prompt fingerprints, models, acceptance, first-attempt passes, attempts, latency, and cost, plus:

- **Deterministic checks**: the representation chosen versus the ones that suit the case, citation coverage for material, recorded limitations where the material has them, absence of a canary string from embedded instructions, a successful portrait layout, and alternatives offered on declines.
- **Independent grades** (`lib/evals/grade.ts`, `EVAL_GRADER_MODEL`, default `gpt-6.1-sol`): request fidelity, source fidelity, representation fit, temporal and causal correctness, essential coverage, and readability and progression, from 1 to 5, plus the language. The grader never sees the pipeline reviewer's verdict.

Neither the pipeline's reviewer nor the grader is proof of accuracy; both are models. Runs are noisy: judge from several cases and repeats.

---

## Deferred: scenarios and "what if"

Explanations are linear sequences of scene snapshots. That is enough to show what happens, but not to let a reader change an input and see a different outcome. A future scenario model would need:

- **State, not snapshots**: a typed model of the entities' state and the rules that change it (for example, Raft terms and votes), so outcomes are computed rather than drawn.
- **Parameters with ranges**, chosen by the reader, validated like any other input, and **deterministic transition functions** written by the application, not generated code.
- **Branches in the story format**: beats whose next beat depends on state, a way to rewind to a branch point, and a player UI for choices.
- **Verification**: every reachable branch must pass the same layout and content checks, which multiplies the cost of generation and review; generated rules would need execution in a sandbox and tests against known cases.
- **Provenance per branch**, so a reader can tell what was computed, assumed, or taken from material.

Until then, "Show another example" covers the common need for a second case, as a separately validated and reviewed explanation.
