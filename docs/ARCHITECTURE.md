# Glassbox architecture

How Glassbox turns a topic into a narrated, animated explanation, and how the pieces fit together. For setup and usage, see the [README](../README.md).

```
topic ──► POST /api/generate ──► planner ──► generator ──► checks ──► reviewer ──► completed event
          (rate limit, SSE)       (AI)         (AI, strict     (code)      (AI)        carries the concept
                                               JSON schema)    │             │                │
                                                     ▲         └─ errors ────┴─ issues ─┐     ▼
                                                     └──────── repair (≤ 3 drafts) ◄─────┘   browser saves it
                                                                                              in localStorage
                                                                                                    │
                                                                                                    ▼
                                         /concept/<id>: concept ──► lib/story/from-concept.ts ──► story player
```

- **The AI writes data, never code.** The generator returns JSON that must match one Zod schema (`lib/concept/schema.ts`). The application decides how everything looks and moves.
- **Nothing is stored on the server.** A finished explanation travels back in the stream; the browser saves it in its own library (localStorage).
- **One player for everything.** Generated explanations, bundled examples, and the hand-written `/learn` stories all play in the same story player (`components/story/`).

---

## Code map

```
app/
  page.tsx                    Home: topic form, gallery (stories, your library, examples), "how it works"
  api/generate/route.ts       POST JSON → SSE stream; rate limit, pipeline, completed event with the concept
  concept/[id]/page.tsx       An explanation saved in this browser (read from localStorage)
  demo/[slug]/page.tsx        A bundled example
  learn/, learn/[slug]/       Hand-written stories (HTTP, Kafka)
  dev/evals/                  Prompt-evaluation results (development only)
components/
  story/StoryPlayer.tsx       Full-screen player: captions, Continue/replay, keys, speed, chapters, a11y
  story/Stage.tsx             SVG renderer for one moment of a story
  story/PanelMark.tsx         Panels: log, code, table, timeline
  story/StorySnapshot.tsx     Static frames for thumbnails
  GenerationLoader.tsx        Streaming progress UI and the request hook
  LibrarySection.tsx          "Your library" on the home page
  SavedExplanation.tsx        Plays a saved explanation from localStorage
lib/
  concept/                    Scene contract: schema, constants, geometry, validator
  story/                      Story format, timeline engine, renderer geometry, converter, linter, DSL
  stories/                    Hand-written stories
  pipeline/                   Roles (prompts), orchestrator, OpenAI client, budget, demo pipeline
  generation/                 Stream lifecycle, client consumer, rate limiter, client key
  sse/                        Event contract (Zod) and a chunk-safe SSE parser
  library.ts                  The browser library (localStorage)
  fixtures/                   Bundled examples
scripts/                      mock-openai (tests), smoke-live and eval-prompts (real API)
tests/                        Unit (Vitest) and browser (Playwright) tests
evals/topics.json             Prompt-evaluation topic set
```

Stack: Next.js 16 App Router (Turbopack), React 19, TypeScript (strict, `noUncheckedIndexedAccess`), Tailwind CSS 4, Zod 4, and the official OpenAI SDK. No database, no accounts, no agent framework.

---

## The scene contract (`lib/concept`)

One canonical Zod schema defines an explanation (a "concept"). TypeScript types are inferred from it, and the same definitions are used for AI structured output, validation, the browser library, and fixtures.

```ts
Concept    { schemaVersion: 1, id: uuid, title, description, steps: Step[4..12] }
Step       { id, text /* ≤ 20 words */, notes?, nodes: VisualNode[0..8], edges: VisualEdge[0..12],
             panels?: Panel[0..3], focus?: id[1..4], timing?: changes_first|messages_first }
VisualNode { id, label /* ≤ 30 chars */, x, y, shape: circle|square, color: <token>, status: active|inactive }
VisualEdge { id, from, to /* node or panel */, label /* ≤ 30 chars, may be "" */, animated: boolean, order?: 1..4 }
Panel      = log      { id, label, x, y, items: Item[0..10] }
           | code     { id, label, x, y, lines: { text /* ≤ 44 chars */, highlight }[1..14] }
           | table    { id, label, x, y, columns: string[1..8], rows: { label, cells: Item[] }[1..8] }
           | timeline { id, label, x, y, items: Item[0..10] }
Item       { text /* ≤ 12 chars in logs and tables, ≤ 24 on timelines */, tag /* offset or date, ≤ 16, may be "" */, color, status }
```

- **Each step is a complete snapshot.** The AI describes what each step looks like; code decides how to animate between them.
- **Colors are semantic tokens:** neutral, primary (what the step is about), secondary, success, warning, danger.
- **Messages travel in rounds.** An animated edge with `order` 2 starts when round 1 has arrived, so a reply can follow its request in one step.
- **Timing.** `changes_first` (default): the scene changes, then messages travel. `messages_first`: messages travel first and the step's changes appear when they arrive (a record lands in a log as its message does).
- **Focus** zooms the camera onto nodes or panels, for example to read code or a table.
- **Wire format.** OpenAI's strict mode requires every key, so `GeneratedConceptContentSchema` makes the optional fields required (`notes` and `focus` nullable, `panels` possibly empty, `timing` and `order` always set). `toConceptContent` converts back and drops defaults.
- **Identity.** The model writes only `title`, `description`, and `steps`; the server assigns `id` and `schemaVersion`.

### Arena and geometry (`constants.ts`, `geometry.ts`)

| | |
| --- | --- |
| Arena | 1000 × 600 logical units, origin top-left. Coordinates are node and panel centers. |
| Nodes | Radius 32 (squares 64 × 64). Labels below the node in up to two lines. |
| Safe zone told to the generator | x 120–880, y 60–500; a test checks that any valid label fits. |
| Minimum separation | 88 units between node centers. |
| Panels | Size follows from content (`panelSize`, constants in `PANEL`): log records 72 × 44, code lines 24 tall at 9.6 per character, table cells 92 × 34, timeline events 92 apart. The validator and the renderer use the same function, so what was checked is what is drawn. |

### Validation (`validate.ts`)

Pure functions return structured issues (`code`, `severity`, `message`, `path`, `stepId`). **Errors** send a draft back to the generator; **warnings** go to the reviewer for context.

- Errors: payload size; schema (unknown fields, types, allowlists, limits); step text over 20 words; duplicate ids; edge endpoints that are not a node or panel in the step; self-edges and duplicate connections; nodes, labels, or panels outside the arena; nodes too close; an edge through another node; panels covering a node, label, or another panel; table rows with the wrong number of cells; log or table cells over 12 characters; focus on something not in the step; an empty scene; a renamed entity (same label, new id) or an edge id reused for a different connection; a panel changing kind.
- Warnings: estimated label overlaps, a node changing shape, an unchanged scene, gaps between message rounds, `messages_first` without messages, `order` on a non-message edge.

Geometry checks use estimated text widths, so they catch clear problems but cannot prove a scene is readable or correct.

---

## The story player (`lib/story`, `components/story`)

Modeled on [The Secret Lives of Data](https://github.com/benbjohnson/thesecretlivesofdata): one sentence at a time at the bottom of a full-screen stage, a scene that animates while it is read, and Continue once it settles.

- **Story format** (`types.ts`). A story has chapters; a chapter has beats; a beat has a caption (or a title card) and a timed script of actions: `add`, `remove`, `set`, `append`, `cell`, `truncate`, `send`, `zoom`, `timer`. Entities are nodes, logs, cursors, cards, text, links, and panels. It is plain data; colors are tokens (`palette.ts`). Hand-written captions support `*em*`, `` `code` ``, and `[text|ink]`; generated captions are `plain: true` and shown exactly as written.
- **Engine** (`engine.ts`). A beat's script is flattened into timed actions. The scene at time `t` is a pure function of the beat's starting snapshot and the actions due by `t`, so replay, skip-to-end, and chapter jumps are deterministic. Positions, zoom, and fades are tweens evaluated at render time.
- **Renderer** (`Stage.tsx`, `PanelMark.tsx`). SVG. Positions map the 0–100 domain to the stage; sizes and fonts use the smaller axis scale so shapes keep their proportions. Panels are drawn at one scale on both axes, inside the box the validator measured.
- **Converter** (`from-concept.ts`). Turns a concept into a story. Each step becomes a beat whose script moves the scene from the previous snapshot: what disappears goes first, nodes glide and recolor, panels update cells in place or append records, new things appear, lines connect, then messages travel in rounds (or, for `messages_first`, messages first and changes on arrival). Focus zooms once its targets exist. Each caption is followed by a short pause so it is read before the scene moves. Notes become smaller follow-up captions.
- **Linter** (`lint.ts`). Checks every action refers to something on stage with valid fields, and (for hand-written stories) that everything stays on stage at any aspect ratio. `tests/story.test.ts` runs it on the bundled stories; `tests/from-concept.test.ts` runs it on every fixture and every concept in `evals/runs/`.
- **Player** (`StoryPlayer.tsx`). → continues (or finishes the running animation), ← replays the previous step. Chapters live in the URL hash and the menu. Speed: Slow / Normal / Fast (0.3×, 0.5×, 1×), changeable mid-step and remembered per browser. Reduced motion shows each step finished, with its messages drawn still. A polite live region announces each caption; the SVG has a text label.

---

## Generation (`lib/pipeline`, `app/api/generate`)

`orchestrator.ts` is pure and dependency-injected (no route imports), so it is unit-testable.

1. **Planner.** Returns a teaching plan: scope, a small cast of entities, panels to use, and a storyboard (example → mechanism → optional failure → takeaway), or declines with a friendly reason and a narrower suggestion. It is told it has consulted no sources.
2. **Generator.** Returns scene JSON through OpenAI Structured Outputs (`strict: true`); the schema is derived from Zod and the result is validated with Zod again.
3. **Deterministic checks** (above). Errors go straight back for repair.
4. **Reviewer.** Returns issues with a category and a severity. A draft is accepted only if the reviewer passes it **and** there are no blocker or major issues. Review is a quality check, not proof of correctness.

**Bounded repair:** at most 3 drafts. **Provider retries** (once, for 429/5xx/network) are separate. Refusals, truncation, invalid JSON, timeouts, cancellation, and HTTP errors each map to a typed error; users never see provider error text.

### Time budget

| Setting | Value |
| --- | --- |
| `maxDuration` | 300 s (Node.js runtime) |
| Server deadline | `GENERATION_DEADLINE_MS`, default 270 s (≤ 290 s); aborts all work |
| Per-call timeouts | planner 90 s, generator 110 s, reviewer 60 s, capped by the time left |
| Output caps | planner 8k, generator 24k, reviewer 8k tokens |
| New attempts | Start only if a minimal generate + review still fits |

Worst case: 1 planner call + 3 × (generator + reviewer).

### POST /api/generate

Request: `{ "topic": string, "idempotencyKey": uuid }` as `application/json`.

Checks before streaming (plain JSON errors): same-origin `Origin`, exact `application/json`, body ≤ 2 KB, schema and topic, mode, and the rate limit (`Retry-After` on 409/429).

Stream: `text/event-stream`, every event with `requestId` and an increasing `seq`.

| Event | Meaning |
| --- | --- |
| `started` | mode (`live` or `demo`), topic, maximum attempts |
| `progress` | stage (`access`, `plan`, `generate`, `validate`, `evaluate`, `persist`), state, message, attempt |
| `attempt` | attempt n of 3: started, rejected (with reasons), or accepted |
| `completed` | `conceptId`, `url` (`/concept/<id>`), and the validated `concept`; in demo mode a link to `/demo/<slug>` |
| `failed` | code, message, `retryable`, reasons |

Heartbeats every 15 s; exactly one terminal event per stream; free text clipped to wire limits. Closing the connection cancels the pipeline and any in-flight OpenAI call; nothing continues in the background. The client (`GenerationLoader`) reads the stream with `fetch` and a chunk-safe parser, treats 45 s of silence as a stall, shows real stages (no fake progress), and offers Cancel, Retry, and Edit topic.

### Rate limiting

`lib/generation/memory-slots.ts`: per visitor, at most `RATE_LIMIT_PER_CLIENT_PER_HOUR` generations per rolling hour and one at a time; site-wide, `RATE_LIMIT_GLOBAL_PER_HOUR`. A visitor is an HMAC of the client IP (from `x-forwarded-for`, which Vercel sets) with a random per-process secret, so raw addresses are never kept. The state is in server memory: it resets on restart and, on serverless platforms, applies per instance. The global limit is what caps OpenAI cost.

### Demo mode

Without `OPENAI_API_KEY` (or with `GENERATION_MODE=demo`), `/api/generate` matches the topic to a bundled example by keyword, validates it, and links to `/demo/<slug>`. No model is called.

---

## The browser library (`lib/library.ts`)

- Saved under the localStorage key `glassbox:library`, newest first, de-duplicated by id. The speed setting uses `glassbox:story-speed`.
- Every read validates each entry again and skips anything invalid (stored data can be edited).
- If storage is full or blocked, the explanation still opens for the current visit and is labeled "not saved".
- Links to `/concept/<id>` work only in the browser that saved the explanation.

---

## Testing

| Command | What it covers |
| --- | --- |
| `npm run check` | Typecheck, lint, unit tests, and a production build |
| `npm test` | Schema and validator (including panels), fixtures, word counting, SSE parsing at every split point, the stream lifecycle, the client consumer, the orchestrator (attempt cap, repair, errors, deadline), the OpenAI client, the story engine and linter, the converter on every fixture and recorded eval concept, the rate limiter, the browser library, and escaping of hostile text |
| `npm run e2e` | Playwright against a running demo-mode app: the player (keys, chapters, speed, smooth motion, travelling messages, reduced motion, focus, phone layout), demo generation, API errors, and accessibility (axe) |
| `E2E_LIVE_BASE_URL=… npm run e2e` | Also the live path with a **mocked** OpenAI: repair, saving to the browser, reopening, deletion, rejection, unsupported topics, and cancellation |
| `npm run eval:prompts` | **Real API.** Runs `evals/topics.json` through the pipeline and writes a report to `evals/runs/` |
| `npm run smoke:live -- "topic"` | **Real API.** Runs the pipeline once and prints progress |

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

Prompts live in `lib/pipeline/roles.ts`. Measure a change with `npm run eval:prompts -- --label <name>` (about $0.13 for the 16-topic set with `gpt-6-luna`) and compare reports in `evals/runs/`; browse the results in the real player at `/dev/evals` while `npm run dev` runs. Runs are noisy: with 14 accept-topics, one topic flipping moves the acceptance rate by 7 points, so judge from several topics and runs, and watch the blocker/major issue counts.
