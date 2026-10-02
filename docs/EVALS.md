# Evaluation results

Prompt evaluations run the cases in [`evals/topics.json`](../evals/topics.json) through the real pipeline with real API calls (`npm run eval:prompts`). Full runs, with every attempt, reviewer issue, grade, and accepted explanation, are written to `evals/runs/` (git-ignored, since they contain model output) and can be browsed in the player at `/dev/evals` during `npm run dev`. This page summarizes the runs made for the broader-explanations release.

## How to read these numbers

- **Accepted**: the pipeline produced an explanation that passed deterministic validation and its own reviewer. That reviewer is part of the pipeline, so acceptance is not evidence of accuracy.
- **Deterministic checks** are computed by code from the accepted explanation: whether the representation is one that suits the case, citation coverage for pasted material (share of non-summary steps citing a claim from it), whether contradictions or gaps were recorded where the material has them, whether text embedded in the material as instructions leaked into the output (a canary string), and whether the explanation also lays out on the portrait (phone) arena.
- **Grades** (1–5) come from a separate judge with its own rubric and a different, stronger model (`gpt-6.1-sol`) that never sees the pipeline reviewer's verdict: request fidelity, source fidelity (material only), representation fit, temporal and causal correctness, essential coverage, and readability and progression, plus whether the language is right. A grade is another model's opinion, useful for comparing versions, not proof of correctness.
- Runs are noisy. Each case ran twice; one case flipping moves a rate by several points.

## Runs

All runs used `gpt-6-luna` for every pipeline role (reasoning effort `low`) and `gpt-6.1-sol` as the grader, on 2 October 2026.

- **broader-v1**: the first version of the new prompts and checks, on all 23 cases, twice each.
- **broader-v2**: after the fixes listed below, on all 23 cases, twice each.
- **broader-v3-targeted**: after a further generator hint and the crowded-timeline check, on the ten cases that had failed or drawn criticism (timelines, hierarchies, pasted material, the German request), twice each. It is not comparable to the full runs as a whole; see the like-for-like table.

| Metric | broader-v1 | broader-v2 | broader-v3-targeted |
| --- | --- | --- | --- |
| Runs (cases × repeats) | 46 | 46 | 20 |
| Accepted (accept cases) | 82% | 87% | 100% |
| Passed on the first draft | 55% | 47% | 39% |
| Mean drafts when accepted | 1.42 | 1.58 | 1.67 |
| Correctly declined | 100% | 100% | n/a |
| Expected representation | 100% | 94% | 95% |
| Citation coverage (material) | 100% | 100% | 100% |
| Limitations recorded where expected | 100% | 100% | 100% |
| Lays out on phones | 94% | 91% | 90% |
| Grade: request fidelity | 4.24 | 4.31 | 4.50 |
| Grade: source fidelity | 4.50 | 4.00 | 4.50 |
| Grade: representation fit | 4.30 | 4.29 | 4.05 |
| Grade: temporal causal | 4.70 | 4.67 | 4.65 |
| Grade: essential coverage | 3.67 | 3.43 | 3.80 |
| Grade: readability progression | 3.94 | 4.06 | 3.90 |
| Grade: right language | 97% | 100% | 100% |
| Mean latency | 85 s | 100 s | 119 s |
| Pipeline cost (all runs) | $0.31 | $0.33 | $0.18 |
| Grader cost | $0.42 | $0.43 | $0.27 |
| Prompt fingerprints (planner/reader/generator/reviewer) | 6628fd19d8 / 075e3a1789 / 56c5472765 / f410cf9c29 | 8af4cf5373 / 3d8630cb6a / 894ea8e5a4 / 9cf455a40d | 8af4cf5373 / 3d8630cb6a / 9302640f52 / 9cf455a40d |

### The same ten hard cases across the three runs

Apollo 11, how a bill becomes law (English and German), the incident review, the warehouse notes, the team notes, the library notes with embedded instructions, vertebrates, TCP vs UDP, and the mortgage, twice each:

| | broader-v1 | broader-v2 | broader-v3-targeted |
| --- | --- | --- | --- |
| Accepted | 13 / 20 | 17 / 20 | **20 / 20** |
| Accepted on the first draft | 8 / 20 | 10 / 20 | 8 / 20 |
| Grades (request / source / representation / temporal / coverage / readability) | 4.38 / 4.33 / 3.85 / 4.77 / 3.77 / 3.85 | 4.35 / 3.86 / 4.00 / 4.63 / 3.53 / 3.94 | 4.50 / 4.50 / 4.05 / 4.65 / 3.80 / 3.90 |
| Pipeline cost for the 20 runs | $0.18 | $0.18 | $0.18 |

### broader-v2 by category

| Category | Outcomes | Mean drafts | Mean grade |
| --- | --- | --- | --- |
| technical flow | 5 accepted, 1 rejected | 2.20 | 4.52 |
| algorithm | 4 accepted | 1.50 | 3.90 |
| historical chronology | 2 accepted | 1.00 | 4.00 |
| process | 1 rejected, 1 accepted | 2.00 | 4.00 |
| parallel incident events | 2 accepted | 1.00 | 4.58 |
| parallel project events | 2 accepted | 1.50 | 4.42 |
| comparison | 4 accepted | 1.50 | 3.95 |
| hierarchy | 4 accepted | 1.75 | 4.05 |
| quantitative | 2 accepted | 1.00 | 4.10 |
| quantitative from material | 2 accepted | 1.00 | 4.58 |
| ambiguous material | 2 accepted | 1.00 | 3.83 |
| instructions in material | 1 accepted, 1 rejected | 2.00 | 3.33 |
| language (material) | 1 rejected, 1 accepted | 3.00 | 3.83 |
| language and audience | 1 accepted, 1 rejected | 2.00 | 3.80 |
| audience | 2 accepted | 1.00 | 4.20 |
| unsupported | 4 declined | n/a | n/a |
| ambiguous topic | 2 declined | n/a | n/a |

## What the runs found, and what changed

From broader-v1:

- **Hierarchies were capped too low.** Accurate taxonomies are deep (vertebrates → jawed → bony → lobe-finned → tetrapods → amniotes), so both vertebrate runs failed: flattening to fit was rightly rejected as misleading. The limit rose from 4 to 6 levels, and trees too wide or deep to fit are drawn as indented outlines. Vertebrates passed in every later run, as a correct six-level tree.
- **Dates went into event text.** The incident review put "09:02" into each event's text and marked every date unknown. A check now rejects dates or times in event text when the date field says unknown, and a new `none` value marks undated process stages (previously shown as "date unknown"). In broader-v2 and v3 the incident review was drawn to scale in four lanes with stated causes.
- **Language names.** Both German-preference runs failed at planning: the planner wrote "Deutsch", the check expected "German". Language names are now matched either way, the planner uses English names, and the material reader reports the material's language, which the plan must match. "Right language" went from 97% to 100%.
- **Essentials were missed.** The grader's most common major note: the steps are right but the key idea is missing (binary search without the halving that makes it fast, dynamic programming without reused subproblems, Raft without terms). The planner now lists 2–4 essentials and the reviewer checks them. The essential-coverage grade did not clearly improve (3.67, 3.43, and 3.80 on the hard cases), so this remains the main quality gap.
- **Cut-off text and unevenly spaced charts** (a comparison cell "Datagrams; no transport-", a balance plotted at months 0, 1, 2, 12, 120, 360 as if evenly spaced) are now rejected by code.
- **Layout**: a ten-event timeline with lanes was 16 units too wide (slots now narrow to fit); connections passing through nodes are now resolved by the layout engine rather than sent back to the model.

From broader-v2:

- **Undated stages were given time positions** 36 times, which a strict check rejected, wasting repair rounds. Positions on undated events are now dropped when the output is converted, and that check was removed (after broader-v3).
- **The reviewer became stricter about pasted material**: eight blocker-level source-fidelity issues, such as a scene showing "the library system" sending a text message when the material does not say who sends it. That is the intended behavior, and part of why fewer drafts pass first time.
- **Crowded to-scale timelines** (events two minutes apart drawn on top of each other) are now rejected, with a hint to the generator.

## Harness corrections

Two broader-v1 numbers came from the evaluation harness, not the pipeline, and were corrected before broader-v2:

- Its validation-error counts included 458 `unknown_claim` errors because the harness checked drafts without their provenance; the pipeline itself never saw those errors.
- Its "embedded instructions ignored" rate read 0% because the check searched the stored copy of the material, which contains the injected text. Re-checked on what readers see, the canary appeared in no accepted explanation in any run, and every such explanation recorded that the material contained instructions to an AI, which were ignored.

## Not measured, or not proven

- The final fixes (dropped time positions on undated events, the review fixes to the new checks, and crossing resolution that can no longer make a layout worse) landed after broader-v3 and are covered by unit and browser tests, not by a live run.
- One DNS run in broader-v2 failed at planning; the harness did not yet record plan-check reasons (it does now), and three fresh DNS plans passed every check.
- "Explain this step", "Make it simpler", and "Show another example" were run once each against the real API (all accepted on the first draft, in 7, 10, and 52 seconds), not as part of the evaluation set.
- Every number above comes from models judging models. Acceptance means the pipeline's own checks and reviewer passed; grades are a stronger model's opinion. Neither is proof of accuracy.
