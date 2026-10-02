# Glassbox: an interactive wiki for technical concepts

Glassbox explains technical concepts as short animated stories. Each explanation is a linear storyboard of 4–12 scenes made of nodes, connections, status changes, and moving messages. Readers step forward and back at their own pace, and every step changes one thing and says why.

You can type a topic such as "Raft consensus". A server-side AI pipeline plans the explanation, drafts the scenes as validated JSON, checks them deterministically, has a second model review them, and revises up to twice. It saves the result only if every check passes. Progress streams to the browser as it happens, and the finished explanation gets a permanent URL.

- **Works immediately:** three curated explanations (Raft leader election, DNS resolution, binary search) and a demo mode that needs no API keys.
- **Data, never code:** the model produces JSON that matches one Zod schema. The renderer decides how anything looks or moves.
- **Honest by default:** progress events report real operations, AI-generated content is always labeled, and nothing that fails review is saved.

> **Scope.** "Interactive" here means reader-controlled progression through animated scenes. The renderer suits concepts that can be explained with a few entities, connections, state changes, and messages (protocols, distributed algorithms, data-structure operations), plus up to three panels per scene: a log, highlighted code, a table, or a timeline. That also covers short code walkthroughs, table-filling algorithms, and sequences of events, technical or not. It is a poor fit for topics that need charts, plots, rendered formulas, images, or maps, and the planner declines those.

---

## Quick start

### 1. Demo mode (no accounts, no keys)

```bash
npm install
npm run dev            # http://localhost:3000
```

With no environment variables set, the app serves the bundled fixtures from `/demo/<slug>`. The topic box matches your text against those three fixtures by keyword. It makes no AI calls, writes nothing to a database, and every screen says so.

### 2. OpenAI only (no database, nothing saved)

Set only `OPENAI_API_KEY` in `.env.local` and leave every Supabase variable unset, then `npm run dev`. Generation is real, but nothing is stored: the finished explanation travels back in the stream, the browser keeps it in this tab's `sessionStorage`, and `/preview` plays it. It is labeled "Not saved" and is gone when the tab closes. Rate limits are kept in server memory, so they reset on restart and are not shared between serverless instances; use the full stack for a deployment. The gallery shows the bundled fixtures.

### 3. Full local stack (Supabase + OpenAI)

Requirements: Node 22.12+, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase start                       # Postgres and the Data API on ports 554xx (supabase/config.toml)
cp .env.example .env.local           # fill in the values printed by `supabase start`, plus OPENAI_API_KEY
npm run dev
```

- Migrations in `supabase/migrations/` and the seed in `supabase/seed.sql` are applied by `supabase start` and `supabase db reset`.
- There are no accounts. Anyone can generate, within a per-visitor and a site-wide hourly limit, and every saved explanation is public.
- The local ports are moved off the CLI defaults so the stack can run beside another Supabase project.

---

## Architecture

```
app/
  page.tsx                  Home: promise, topic form, gallery, "how it works"
  concept/[id]/page.tsx     Saved explanation (Supabase, RLS-scoped read, validated before render)
  demo/[slug]/page.tsx      Bundled fixture (no database)
  api/generate/route.ts     POST JSON → SSE stream; rate limit, pipeline, persistence
components/
  InteractivePlayer.tsx     The player: arena, caption, controls, keyboard, a11y
  player/SceneArena.tsx     SVG renderer and motion (Framer Motion motion values)
  GenerationLoader.tsx      Streaming progress UI and its request hook
lib/
  concept/                  Canonical schema, constants, geometry, validator, descriptions, palette
  pipeline/                 Roles (planner, generator, reviewer), orchestrator, budget, OpenAI client, demo
  sse/                      Event contract (Zod) and a chunk-safe SSE parser/encoder
  generation/               Stream lifecycle (server) and streaming-fetch client + reducer (browser)
  data/                     Supabase data access and rate-limit RPC wrappers
  fixtures/                 Curated explanations + seed SQL generator
supabase/                   config.toml, migrations, seed.sql
scripts/                    generate-seed, mock-openai (tests), smoke-live (real API)
tests/                      unit (Vitest), db (real Postgres), e2e (Playwright)
```

Stack: Next.js 16 App Router (Turbopack), React 19, TypeScript (strict, `noUncheckedIndexedAccess`), Tailwind CSS 4, Framer Motion, Zod 4, Supabase (`@supabase/ssr`), and the official OpenAI SDK. No agent framework or job queue is used.

---

## The scene contract

One canonical Zod schema, in `lib/concept/schema.ts`, defines a concept. TypeScript types are inferred from it, and the same definitions are used for:

| Use | How |
| --- | --- |
| AI structured output | `GeneratedConceptContentSchema`, derived from the canonical shapes. The only difference is that `notes` is `string \| null`, because strict mode requires every key to be present. |
| Server validation | `validateConcept()` runs the schema and then the semantic checks. |
| Database writes and reads | `concepts.content` stores the full canonical `Concept`. It is validated again before insert and after every read. |
| Renderer input | `InteractivePlayer` accepts only a validated `Concept`. |
| Test fixtures | `lib/fixtures/*` are typed as `Concept` and validated in tests and by the seed generator. |

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
Item       { text /* ≤ 12 chars in logs and tables, ≤ 24 on timelines */, tag /* offset or date, may be "" */, color, status }
```

**Identity versus content.** The model writes only `title`, `description`, and `steps`. The server assigns `id` (a UUID) and `schemaVersion`, and the database row holds `visibility`, `origin`, timestamps, and generation metadata. The model never chooses publication status.

**Each step is a complete snapshot.** Navigation picks which snapshot to show. This is a linear storyboard, not a state machine, and it has no branching.

**Panels, rounds, focus, and timing** were added later as optional fields, so earlier concepts stay valid; the OpenAI wire schema requires them (empty or default). A panel's size follows from its content (`panelSize` in `lib/concept/geometry.ts`, constants in `PANEL`), and the validator and the renderer use that same layout: panels must stay inside the arena and off nodes, labels, and each other. Messages with `order` 2 start when round 1 has arrived, so a reply can follow its request in one step. `timing: messages_first` applies the step's node and panel changes when its messages arrive (a record lands in a log as its message does). `focus` zooms the camera onto nodes or panels, for example to read code or a table.

### Arena and geometry (`lib/concept/constants.ts`)

| | |
| --- | --- |
| Arena | 1000 × 600 logical units, origin top-left. Coordinates are node centers. The SVG uses a fixed `viewBox`. |
| Nodes | Circle radius 32. Squares are 64 × 64 with corner radius 10. |
| Labels | Drawn below the node in at most two lines (balanced word wrap, hard break for very long words). Font 16 units, line height 19, estimated glyph width 8.6. |
| Safe margin | 16 units from every edge for nodes and labels. |
| Minimum separation | 88 units between node centers in one step. |
| Safe zone told to the generator | x 120–880, y 60–500. Any valid label fits there; a test checks this claim. |
| Edges | Quadratic paths that start and end on the shape boundary (circle or box intersection), with an arrowhead at the target. A→B and B→A are drawn as two opposite curves. |

### Limits

4–12 steps, 0–8 nodes (at least one node or panel), at most 12 edges and 3 panels per step, labels ≤ 30 characters, step text ≤ 20 words and ≤ 160 characters, notes ≤ 600 characters, title ≤ 80, description ≤ 280, ids ≤ 40 characters (`[A-Za-z0-9][A-Za-z0-9_-]*`), topic 3–120 characters, request body ≤ 2 KB, and serialized concept ≤ 64,000 bytes.

**Word-counting rule.** Trim the text, then count maximal runs of non-whitespace. Punctuation stays attached to its word. Hyphenated or dotted tokens such as `up-to-date` and `example.com` count once, and a symbol standing alone, such as `→`, counts as a word.

### Rendering safety

Generated content is rendered only as React text children and attributes from allowlists. It never uses `dangerouslySetInnerHTML`, `eval`, `new Function`, generated class names, or generated styles. Shapes, colors (six semantic tokens mapped in `lib/concept/palette.ts`), and animation timings are owned by the application. Unknown fields anywhere in the JSON are rejected. A test renders hostile strings and asserts that they appear as text.

---

## The player

Readers see every explanation (saved at `/concept/<id>`, bundled at `/demo/<slug>`, unsaved at `/preview`) in the full-screen story player described under "Narrated stories" below. `lib/story/from-concept.ts` converts a validated concept into a story: each step becomes one caption whose script moves the scene from the previous snapshot to this one. Nodes fade out, glide, recolor, or appear. Static edges become lines, animated edges become messages that travel once, and notes follow as smaller captions. Colors map through tokens (`primary` gets the solid "leader" outline, inactive nodes turn gray), and generated text is rendered as plain text. Homepage thumbnails are static frames of the same renderer (`components/story/StorySnapshot.tsx`).

The prompt-evaluation pages (`/dev/evals`) use the same story player. The earlier step-by-step player below, `components/InteractivePlayer.tsx`, is no longer used by any page; it is kept, with its tests, until it is removed. It does not draw panels.

- **Motion.** Each entity id has a pair of Framer Motion values for the whole concept. Nodes animate their values between snapshots, and edges recompute their path from those same values on every frame, so they stay attached while nodes move. A Playwright test samples this mid-transition. Entering and exiting nodes and edges fade; color and status changes tween; `animated` edges carry a looping message dot.
- **Rapid navigation.** Index updates are functional. A new step stops every running position animation before starting the next, so a stale animation can never finish later and overwrite a newer position.
- **Reduced motion.** With `prefers-reduced-motion`, positions jump, fades are 120 ms, and message dots are drawn statically at 60% of the edge, so the message is still visible without movement. Changes to the preference are honored live.
- **Teaching UI.** It shows the title and description, a large arena, the step sentence, "What changed" (computed by diffing snapshots, with messages first), optional notes, Previous, Next, and Restart, "Step X of Y" with a progress bar, a legend, and a text description of the scene.
- **Accessibility.** The arrow keys work page-wide on concept pages and are ignored in form fields or with modifier keys. Boundary buttons use `aria-disabled`, so focus stays on them. A polite live region announces each step. The SVG has a label and a description. Status is shown by a glyph, a dashed outline, and the word in labels, never by color alone.
- **Narrow screens.** Using a container query, nodes show stable numbers instead of labels, and a "Scene key" lists the entities and connections, because 16-unit labels would be about 6 px on a phone.
- **SVG ids.** Marker ids are prefixed with `useId()`, so several players can share a page.
- **URL state.** `?step=N` is kept in sync with `history.replaceState`, so you can link to a specific step.

---

## Narrated stories (`/learn`)

`/learn/http` and `/learn/kafka` are hand-written, full-screen explanations modeled on [The Secret Lives of Data](https://github.com/benbjohnson/thesecretlivesofdata). One sentence appears at a time while the scene animates: nodes appear, messages travel between them, log records are appended and committed, and the camera zooms. The reader presses Continue (→) or replays the previous step (←). Each chapter has a URL hash, such as `/learn/kafka#replication`.

- **Format.** `lib/story/types.ts`: a story has chapters, a chapter has beats, and a beat has a caption plus a timed script (`add`, `set`, `send`, `append`, `cell`, `zoom`, `timer`, …). It is plain data. Colors are tokens mapped in `lib/story/palette.ts`, and captions use a tiny markup (`*em*`, `` `code` ``, `[text|ink]`) that is rendered as React text.
- **Engine.** `lib/story/engine.ts` flattens each beat into timed actions. The scene at time `t` is a pure function of the beat's starting snapshot and the actions due by `t`, so replay, skip-to-end, and chapter jumps are deterministic. `components/story/Stage.tsx` draws it as SVG, and `StoryPlayer.tsx` runs the clock.
- **Authoring.** Stories live in `lib/stories/`, written with the helpers in `lib/story/dsl.ts`. `lintStory()` checks references, fields, caption colors, and a worst-case "stays on stage" bound for any aspect ratio. `tests/story.test.ts` runs it on every bundled story.
- **Speed.** Stories are timed at the original's pace, and the player runs them at half that speed by default. A Slow / Normal / Fast selector in the top bar (0.3×, 0.5×, 1×) changes it, even mid-step, and the choice is remembered in the browser (`components/story/speed.ts`). Converted explanations also pause 0.6 s (story time) after each caption before the scene changes.
- **Reduced motion.** Each beat shows its finished state, with that beat's messages drawn statically partway along their path.

---

## The generation pipeline

`lib/pipeline/orchestrator.ts` is a pure, dependency-injected module with no route or database imports. The route handler only wires it to OpenAI, Supabase, and the SSE stream.

1. **Planner (extractor).** Takes the topic and returns a `TeachingPlan`: concept, audience, central mechanism, scope, prerequisites, a stable entity cast, a storyboard (example → mechanism → optional failure or misconception → takeaway), simplifications, assumptions, and uncertainty. The planner can return `unsupported` or `ambiguous` with a message for the user. It is told that it has not consulted sources and must not cite any. No retrieval happens.
2. **Generator.** Takes the plan, plus the previous candidate and a critique when repairing, and returns scene JSON through OpenAI Structured Outputs with `strict: true`. The JSON Schema is derived from the Zod schema with `zodTextFormat`, and the parsed output is validated with Zod again.
3. **Deterministic validation.** Runs before any review. Error-level issues send the candidate straight back for repair, with the issue list.
4. **Reviewer (evaluator).** Returns `{ passed, summary, issues[] }`. Each issue has a category (accuracy, coherence, text–scene consistency, progression, continuity, readability, overclaiming), a severity (blocker, major, or minor), a step id, and a suggested correction. The application decides acceptance: `passed` must be true *and* there must be no blocker or major issues. The review is a quality check, not proof of correctness.

**Bounded repair.** There are three generator attempts in total: one initial attempt and at most two revisions. Every repaired candidate is validated and reviewed again. Malformed or truncated generator output also uses up an attempt and is repaired with a description of the problem. If no attempt passes, the request fails with the last reasons and **nothing is saved**.

**Provider retries are separate.** The OpenAI client retries a call at most once for 429, 5xx, or connection errors. Repair attempts are a different budget.

**Errors handled explicitly.** Refusals, incomplete output (token limit or content filter), non-JSON or schema-mismatched output, schema-conversion problems, timeouts, cancellation, and HTTP errors each map to a typed error. Messages shown to users never include provider error text.

**Metadata.** The saved row records models, attempt count, latency, per-call token usage, and the reviewer summary. The server logs one JSON line per request containing only metadata, never the topic, prompts, or content.

### Time budget

Streaming does not extend function execution limits, so the whole pipeline is bounded inside the request:

| Setting | Value |
| --- | --- |
| Runtime | Node.js (`export const runtime = "nodejs"`) |
| `maxDuration` | 300 s, the Vercel default with Fluid Compute on all plans |
| Server deadline | `GENERATION_DEADLINE_MS`, default 270 s, validated to be ≤ 290 s. It aborts all work. |
| Reserve | 12 s kept for the save and the terminal event |
| Per-call timeouts | planner 90 s, generator 110 s, reviewer 60 s, each capped by the time remaining |
| Output caps | planner 8k, generator 24k, reviewer 8k tokens (reasoning tokens included) |
| New attempts | Start only if a minimal generate plus review (45 s) still fits |

In the worst case, cost is bounded at 1 planner call plus 3 × (generator + reviewer) calls. With slow models, the third attempt is often skipped for lack of time, and the failure message says so. If a deployment needs more room, the next step is a durable job (for example a queue or workflow) with SSE as the progress transport only. That is deliberately not built here.

### POST /api/generate

Request: `{ "topic": string, "idempotencyKey": uuid }` sent as `application/json`.

**Checks before streaming**, which return plain JSON errors: same-origin `Origin`, an exact `application/json` media type, body size, schema and topic validation, mode configuration, the idempotency short-circuit, and the shared rate limit. Rate-limit and in-progress responses carry `Retry-After`.

**Stream:** `text/event-stream` with `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. Every event has `requestId` and a strictly increasing `seq`.

| Event | Meaning |
| --- | --- |
| `started` | mode (`live` or `demo`), topic, maximum attempts |
| `progress` | stage (`access`, `plan`, `generate`, `validate`, `evaluate`, `persist`), state (`running`, `done`, `failed`), message, attempt |
| `attempt` | attempt n of 3: started, rejected (with reasons), or accepted |
| `completed` | `conceptId` and `url`. Sent **only after the database insert resolves.** `persisted: false` in demo mode and without a database; in the latter case the event also carries the validated `concept`, and `url` is `/preview`. |
| `failed` | code (`unsupported_topic`, `model_refused`, `rejected`, `timeout`, `provider_error`, `persistence_failed`, `cancelled`, `internal`), message, `retryable`, reasons |

Comment heartbeats are sent every 15 s. Exactly one terminal event ends every stream that started, including after unexpected exceptions. If work ignores an abort (for example a hung network call), the stream stops waiting after a 3 s grace period and sends the terminal event itself. Free text in events, which can include model-written summaries, is clipped to the wire limits before sending. Timers, listeners, and the generation lease are cleaned up on every path. `after()` keeps the function alive for cleanup if the client disconnects.

**Cancellation.** Closing the connection (Cancel, navigating away, or a network drop) aborts the pipeline, any in-flight OpenAI call, and the database insert. Nothing continues in the background; this MVP does not support durable background completion. One edge case remains: a disconnect during the final insert can still save the row if the request had already reached Postgres. The UI says so, and a retry with the same idempotency key opens it.

**Duplicate submissions.** The UI ignores a second start while one is running and never starts requests from effects. The server holds a per-visitor lease in Postgres, so a second concurrent request from the same visitor gets 409. "Retry" reuses the same idempotency key, so if the first attempt was saved just before the connection dropped, the retry returns that saved explanation instead of generating a new one.

**Client.** `GenerationLoader` reads the stream with `fetch` and a chunk-safe parser that handles UTF-8 and CR/LF split across chunks. Native `EventSource` cannot send a POST. The client treats 45 s without any bytes as a stall. It shows real stages and the attempt number with no percentage or ETA, offers Cancel, Retry, and Edit topic, shows a specific message for each failure type, and navigates only after `completed`.

---

## Data and access control

`supabase/migrations/20261001120000_concepts.sql` creates the `concepts` table, and `20261002120000_remove_accounts.sql` removes accounts from it. There is no sign-in: every visitor is anonymous.

- **Columns.** UUID primary key, title, description, schema version, validated JSONB content, `visibility` (`public` or `private`), `origin` (`curated` or `ai_generated`), source topic, idempotency key, generation metadata, a generated `step_count`, and `created_at`/`updated_at` (maintained by a trigger).
- **Constraints.** Length and shape checks. The JSON must agree with the row's id, title, description, and version. There is a size backstop.
- **Indexes.** Recent public concepts, and unique idempotency key.

**Row Level Security**
- Anyone can `SELECT` rows where `visibility = 'public'`. Rows saved as `private` before accounts were removed stay unreadable through the API; they were not made public.
- There are no insert, update, or delete policies, and `INSERT/UPDATE/DELETE/TRUNCATE` are revoked from `anon` and `authenticated`. Visitors cannot write at all.

**Server writes.** The route validates the content again and then inserts with the secret (service-role) key, with `visibility = 'public'` and `origin = 'ai_generated'`. Pages read with the anonymous key, so RLS decides visibility, and a hidden concept looks exactly like a missing one (404).

**Rate limiting.** `claim_generation_slot` and `release_generation_slot` are `SECURITY DEFINER` functions over tables in a `private` schema that the Data API does not expose. Only `service_role` can execute them. They enforce a per-visitor hourly limit, a global hourly limit, and one running generation per visitor. A visitor is identified by a client key: an HMAC of the client IP keyed with the server secret, so raw addresses are never stored (`lib/generation/client-key.ts`). The IP comes from `x-forwarded-for`, which Vercel sets. Behind no such proxy the header can be spoofed, so the global limit is what caps cost. Because the state lives in Postgres, the limits hold across serverless instances. The lease expires after 330 s if an instance dies.

Newly generated concepts are public and listed in Explore, labeled as AI-generated. Editorial review is out of scope for this MVP.

---

## Deterministic validation (`lib/concept/validate.ts`)

Pure functions return structured issues (`code`, `severity`, `message`, `path`, `stepId`):

- **Errors:** payload size, schema (version, unknown fields, types, allowlists, finite coordinates, every count and length limit), step text over 20 words, blank text or labels, duplicate step ids, duplicate entity ids within a step (nodes and edges share one namespace), edge endpoints not in the step, self-edges, duplicate connections, a node or its label outside the arena margins, nodes closer than 88 units, an edge passing through another node, an edge id reused for a different connection in the next step, and an entity that was clearly renamed (same label, new id, old id gone).
- **Warnings** (shared with the reviewer, never blocking): estimated label overlaps, a shape change for the same id, and an unchanged scene between steps.

**Limitations.** Label widths are estimated from character counts with a conservative average glyph width, and edges are checked as straight segments. These heuristics catch clear problems but cannot prove that a scene is readable or that an explanation is correct. Database content is validated again before rendering, and invalid records show an explicit error instead of a broken player.

---

## Demo mode

Demo mode is active when `OPENAI_API_KEY` is not set, or when `GENERATION_MODE=demo`.

- `/api/generate` matches the topic to a bundled fixture by keyword, runs the real validator on it, and completes with `persisted: false` and a link to `/demo/<slug>`. It does not call a model.
- Without Supabase, the gallery shows the bundled fixtures, labeled "Bundled demo".
- The UI labels demo mode on the form, in the loader, and on the page provenance.

---

## Testing

| Command | What it covers |
| --- | --- |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript) |
| `npm test` | Vitest unit tests: schema and validator rejections, fixtures, safe-zone claim, word counting, SSE parsing at every split point (including UTF-8 and CRLF), the client stream consumer (HTTP errors, early end, out-of-order events, cancellation, stalls), stream lifecycle (completed only after the save, heartbeats, cancel and deadline abort, cleanup), the orchestrator (3-attempt cap, no persist on failed review, repair inputs, error mapping, deadline), the OpenAI client (refusal, incomplete, invalid JSON, schema mismatch, HTTP errors, abort versus timeout, strict-schema conversion), the player (rapid navigation, boundaries, keyboard handling, unique markers, escaping), and env parsing |
| `npm run test:db` | Against a real Supabase (`supabase start`): public reads, hidden private rows, writes denied to the anonymous role, table constraints, and RPC grants and per-visitor limits |
| `npm run e2e` | Playwright against a running app in demo mode: navigation, URL step state, rapid clicks, **edge attachment sampled mid-transition**, shape-boundary termination, reduced motion, moving pulses, focus, the mobile layout, the demo generation flow, and API pre-stream errors |
| `E2E_LIVE_BASE_URL=… npm run e2e` | Also runs `tests/e2e/live-mock.spec.ts`: the **live path with a mocked model provider**. It uses the real rate limit and lease, real persistence and RLS, repair, rejection, unsupported topics, cancellation, and idempotency. |
| `npm run eval:prompts` | **Real OpenAI calls** across the prompt-evaluation topic set; see "Improving the prompts" below |
| `npm run smoke:live -- "topic"` | **Real OpenAI calls** (costs money). Runs the pipeline and prints progress. It does not write to the database and skips itself when `OPENAI_API_KEY` is unset. |

### Improving the prompts

`npm run eval:prompts` runs the topic set in `evals/topics.json` through the **real** pipeline. It makes OpenAI calls (about $0.005 per topic with `gpt-6-luna`) and writes nothing to the database. For every attempt it records the validation errors and the reviewer's issues, then writes `evals/runs/<timestamp>-<label>/report.md` and compares the run with the previous one. Browse the results, including the generated explanations in the real player, at <http://localhost:3000/dev/evals> while `npm run dev` is running. That page is disabled in production builds.

```bash
npm run eval:prompts -- --label my-change --repeat 2   # repeat each topic to reduce noise
npm run eval:prompts -- --only "raft"                    # one topic while iterating
```

Treat small differences with care: with 9 topics, one run flipping changes a rate by 11 points. The blocker/major issue counts in the report are a steadier signal than the pass rates.

To run the live-mode browser tests locally:

```bash
supabase start
npm run build
npm run mock:openai &                                         # mock Responses API on :4010
GENERATION_MODE=live OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=http://127.0.0.1:4010/v1 \
  RATE_LIMIT_PER_CLIENT_PER_HOUR=50 npx next start -p 3100 &
GENERATION_MODE=demo npx next start -p 3000 &                  # demo-mode server
E2E_LIVE_BASE_URL=http://localhost:3100 npm run e2e           # add PW_CHANNEL=chrome to use installed Chrome
```

---

## Deploying (Vercel + Supabase)

1. **Supabase project.** Link the project and push the schema: `supabase link --project-ref <ref>`, then `supabase db push`. Load the curated explanations with `psql "$DATABASE_URL" -f supabase/seed.sql`.
2. **Vercel project.** Set the environment variables from `.env.example`. `SUPABASE_SECRET_KEY` and `OPENAI_API_KEY` must be server-only and must not use a `NEXT_PUBLIC_` prefix. Anyone can generate, so keep `RATE_LIMIT_GLOBAL_PER_HOUR` at a level whose OpenAI cost you accept.
3. **Function duration.** The route declares `maxDuration = 300`, which requires Fluid Compute (the default for new projects). If your plan or platform allows less, lower `GENERATION_DEADLINE_MS` so it stays at least about 20 s below the limit.
4. **Model.** The default is `gpt-6-luna`, chosen from the SDK's model list and **not verified against a live account here**. Set `OPENAI_MODEL`, and leave `OPENAI_REASONING_EFFORT` unset if the model you choose does not support it. Run `npm run smoke:live` once to confirm that the model accepts the strict schemas.
5. Run `npm run check` (typecheck, lint, unit tests, build) before deploying.

---

## Known limitations

- The renderer is intentionally narrow: at most 8 nodes, straight or slightly curved edges, and no free-form drawing. Some concepts will be declined, or simplified more than an expert would like.
- Automated review uses the same family of model as the generator and has no sources. It catches many problems but not all. AI-generated explanations are labeled as such and are public as soon as they pass.
- Geometry checks are estimates (see above).
- Generation is request-scoped: closing the tab cancels it.
- The curated fixtures are hand-written data in this repository. Please open an issue if you spot a technical inaccuracy.

## License

[MIT](LICENSE)
