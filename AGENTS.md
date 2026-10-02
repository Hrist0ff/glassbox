<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes (Glassbox)

- The scene contract lives in `lib/concept/schema.ts` and `lib/concept/constants.ts`. Change limits there only; the validator, layout engine, renderer, prompts, and docs read them. Panel sizes come from `panelSize` (`lib/concept/geometry.ts`) and the frames in `lib/concept/frames.ts`, used by the validator, the layout engine (`lib/concept/layout.ts`), and the renderers in `components/story/panels/`; keep them in step.
- The generator never writes coordinates: it places nodes on a grid and the layout engine computes positions (landscape when generating; portrait again at render time, falling back to landscape).
- Concepts are `schemaVersion` 2; `migrateConcept` upgrades version 1. A new validation rule must not invalidate stored explanations: scope it to content that could not exist before, or to a new version. Library writes must never drop entries they cannot read.
- Pasted material is data: it stays inside `fence()` blocks, and a claim may say "stated in the source" only if `lib/sources/passages.ts` finds its excerpt in the cited passage (checked when generating and on every read).
- Generated content is data. Never render it with `dangerouslySetInnerHTML`, never derive class names or styles from it, and map visual properties through tokens (`lib/story/palette.ts`, `INK_FOR`/`TONE_FOR` in `lib/story/from-concept.ts`). Generated captions are `plain: true`.
- `lib/pipeline/orchestrator.ts` must stay free of route/database imports so it remains unit-testable; wire dependencies in `app/api/generate/route.ts`.
- `completed` may only be emitted after persistence resolves; terminal events are sent by `lib/generation/stream.ts`, not by pipeline code. Nothing is stored on the server: `persist` receives the product, which is sent in `completed`; the browser saves an explanation to its library (`lib/library.ts`, localStorage key `glassbox:library`) and opens `/concept/<id>`, and keeps a step supplement (explain, simplify, another example) under `glassbox:supplements`.
- There are no accounts and no database. Saved explanations live only in the visitor's browser; every library read is re-validated with `validateConcept`, since storage can be edited. Rate limits are in memory (`lib/generation/memory-slots.ts`), keyed by `lib/generation/client-key.ts`.
- Checks: `npm run check` (typecheck, lint, unit, build) and `npm run e2e` (needs a running app; see `docs/ARCHITECTURE.md`). Internals are documented in `docs/ARCHITECTURE.md`; keep it in step.
- Narrated `/learn` stories (The Secret Lives of Data style) are separate from the scene contract: format in `lib/story/types.ts`, stories in `lib/stories/`. Every story must pass `lintStory()` (enforced by `tests/story.test.ts`).
- Every concept is shown in that same story player: `lib/story/from-concept.ts` converts concept → story at render time (no stored data changes). `tests/from-concept.test.ts` checks the conversion against the fixtures and all concepts in `evals/runs/`. Generated captions use `plain: true`, so they are never parsed as caption markup.
- Prompts live in `lib/pipeline/roles.ts`; all roles share one capability description and one timing contract (`tests/prompts.test.ts` pins them). Measure prompt changes with `npm run eval:prompts -- --label <name> --repeat 2` (real API, small cost; an independent grader adds about $0.40) and compare reports in `evals/runs/`; don't judge a change from a single topic, and don't treat the pipeline's own reviewer or the grader as proof of accuracy. Summaries of notable runs go in `docs/EVALS.md`.
