<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes (Glassbox)

- The scene contract lives in `lib/concept/schema.ts` and `lib/concept/constants.ts`. Change limits there only; the validator, renderer, generator prompt, and docs read them. Panel sizes come from `panelSize` (`lib/concept/geometry.ts`), used by both the validator and `components/story/PanelMark.tsx`; keep them in step.
- Generated content is data. Never render it with `dangerouslySetInnerHTML`, never derive class names or styles from it, and map visual properties through tokens (`lib/story/palette.ts`, `INK_FOR`/`TONE_FOR` in `lib/story/from-concept.ts`). Generated captions are `plain: true`.
- `lib/pipeline/orchestrator.ts` must stay free of route/database imports so it remains unit-testable; wire dependencies in `app/api/generate/route.ts`.
- `completed` may only be emitted after persistence resolves; terminal events are sent by `lib/generation/stream.ts`, not by pipeline code. Nothing is stored on the server: `persist` returns the concept, which is sent in `completed`; the browser saves it to its library (`lib/library.ts`, localStorage key `glassbox:library`) and opens `/concept/<id>`.
- There are no accounts and no database. Saved explanations live only in the visitor's browser; every library read is re-validated with `validateConcept`, since storage can be edited. Rate limits are in memory (`lib/generation/memory-slots.ts`), keyed by `lib/generation/client-key.ts`.
- Checks: `npm run check` (typecheck, lint, unit, build) and `npm run e2e` (needs a running app; see `docs/ARCHITECTURE.md`). Internals are documented in `docs/ARCHITECTURE.md`; keep it in step.
- Narrated `/learn` stories (The Secret Lives of Data style) are separate from the scene contract: format in `lib/story/types.ts`, stories in `lib/stories/`. Every story must pass `lintStory()` (enforced by `tests/story.test.ts`).
- Every concept is shown in that same story player: `lib/story/from-concept.ts` converts concept → story at render time (no stored data changes). `tests/from-concept.test.ts` checks the conversion against the fixtures and all concepts in `evals/runs/`. Generated captions use `plain: true`, so they are never parsed as caption markup.
- Prompts live in `lib/pipeline/roles.ts`. Measure prompt changes with `npm run eval:prompts -- --label <name>` (real API, small cost) and compare reports in `evals/runs/`; don't judge a change from a single topic.
