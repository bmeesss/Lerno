# AI prompt/context optimization — 2026-09-28

## Measurement first

Baseline: `034df40`, measured before editing the prompts. Token counts below use
`o200k_base` locally, **not** Groq's complete chat template. `js-tiktoken` is a
**dev-only** dependency; production history processing does not tokenize or call
another model.

| System prompt     | Before tokens | After tokens |
| ----------------- | ------------: | -----------: |
| Study / free chat |           382 |          169 |
| Explain           |           259 |          144 |
| Summarize         |           215 |          125 |
| Questions         |           285 |          181 |
| Cards             |           225 |          157 |
| Quiz              |           293 |          193 |
| Evaluate          |           223 |          158 |
| Hint              |           128 |          112 |
| Card action       |           221 |          147 |

Free-chat system text: **1,735 → 815 characters**, **56% fewer content tokens**.
A fresh “Hallo” has just two messages: system + user (one content token), no
history, no profile/account metadata, no duplicate system prompt. New content
total: **170**, previously **383**. JSON roles/wrappers are transport structure;
the provider converts them into its model-specific chat template. Model name,
temperature and output budget are request settings, not extra user instructions.
The user's reported ~475 input tokens cannot be exactly reconciled without actual
Groq usage. Do not present 170 as a measured Groq prompt-token count.

## Context strategy

- Sanitize and inspect at most the accepted 30 entries / 48,000 characters.
- Keep at most two relevant user/assistant groups, newest first for selection,
  chronological when sent. Consecutive assistant entries collapse to the latest.
- Lexical overlap selects older context; short or referential follow-ups retain
  the most recent group even without overlap (e.g. “Wat is massa?” → “En gewicht?”).
- Standalone unrelated questions drop old turns. School-level tokens do not
  count as topical overlap.
- Remember only an allowlisted level/year from user messages; assistant claims
  cannot change it. Explicit new levels override older ones; simple negations
  such as “niet vwo” do not promote the student.
- Long messages become **extracts**, not invented summaries: preserve beginning
  and end with `[…]`. User: 600 chars; assistant: 1,000; history total: 3,200.
  The current user message retains the existing 2,000-character cap.
- Accepted API limits, sanitization, auth, quotas, ownership checks, JSON schemas,
  retries, leak guards and frontend renderer remain in place. Leak fingerprints
  additionally recognize the new prompt.

This is deliberately a cheap heuristic, not semantic retrieval. Ambiguous short
questions may retain unnecessary context; references to omitted middle passages
or older-than-accepted turns can still lose detail. Level-policy tests verify
request shaping, **not** curriculum correctness of a live model response.

## Output budgets and cleanup

Budgets are ceilings, not length targets:

| Task                              | Visible-answer allowance |
| --------------------------------- | -----------------------: |
| Greeting                          |                       96 |
| Arithmetic                        |                      200 |
| Short definition / why question   |                      320 |
| Chat hint                         |                      160 |
| Single practice question          |                      280 |
| Normal chat explanation           |                      800 |
| Explicit detailed/complex request |                    1,800 |
| Set explain / summarize / card    |          650 / 450 / 300 |
| Structured hint / evaluate        |                120 / 220 |

Existing count-dependent generation allowances are retained:
questions/quiz `min(2200, 520 + 110 × count)`, cards
`min(4000, 600 + 110 × count)`; their JSON contracts still need room.

For GPT-OSS only, request low reasoning effort and reserve **256 additional
completion tokens**, because hidden reasoning shares its output ceiling. Chat
still respects `GROQ_MAX_OUTPUT_TOKENS` as an absolute ceiling. Other models use
the task budget directly. Actual reasoning use and quality require live
validation; the reserve is not a provider guarantee.

Cleanup is prose-only, after leak checking: remove a few exact standalone stock
openers/closers and collapse excessive blank lines. Do not guess where a repeated
question ends, alter formulas, touch structured JSON, or rewrite code fences.
Existing renderer tests remain green; no renderer changes were needed.

## Reproducible audit

From the repository root:

```sh
npx tsx backend/scripts/measure-ai.ts
node --expose-gc --import tsx backend/scripts/measure-ai.ts
# Only with GROQ_API_KEY already configured securely in the environment:
npx tsx backend/scripts/measure-ai.ts --live
```

The script logs IDs, numerical metrics and boolean smoke checks only, never
prompt/response content or credentials. Live mode obtains a real preceding answer
for the follow-up case. Existing production logs keep provider input/output/total
tokens, duration and outcome; no estimated history count is mislabeled as a
provider metric.

Local results (content tokens, excluding model wrappers):

| Case                                   | System | History | Current user | Message count |
| -------------------------------------- | -----: | ------: | -----------: | ------------: |
| Hallo                                  |    169 |       0 |            1 |             2 |
| 15% van 240                            |    169 |       0 |            9 |             2 |
| Fotosynthese, mavo 3                   |    169 |       0 |           13 |             2 |
| Moeilijke massa/gewichtvraag, mavo 3   |    169 |       0 |           15 |             2 |
| Gewicht op de maan                     |    169 |       0 |            8 |             2 |
| En gewicht?                            |    176 |      30 |            3 |             4 |
| Long chat (30 input entries)           |    176 |     812 |            6 |             6 |
| Independent arithmetic after long chat |    176 |       0 |            9 |             2 |

The additional seven system tokens are a remembered level, not old prose.
Identical synthetic long-history input previously sent 12 entries / 15,468 chars /
3,966 content tokens; now four history entries / at most 3,200 chars / 812 tokens
(**80% fewer history tokens** in this fixture). Growth stops at the fixed cap.

1,000 long-history builds: **0.30 ms/request** in this sandbox. With explicit GC,
retained heap delta was -62,560 bytes (GC noise, not a meaningful negative
allocation claim). This is a microbenchmark, not a production latency or peak-RAM
measurement. Runtime uses bounded string/array operations; no embeddings, NLP
service, vector database or summarization call.

Token regression tests use generous bounds with a wrapper reserve rather than
exact token snapshots: fresh greeting <300; short follow-up <450; each task
prompt <270; mixed-Unicode long-history fixture <3,500. Runtime hard bounds are
characters, not a universal tokenizer-independent token promise.

## Verification and remaining release gate

Passed:

- `npm test`: **446 backend + 166 frontend tests** (62 files).
- `npm run lint`: no errors or warnings.
- `npm run typecheck`.
- `npm run build`.
- Offline audit and context CPU/heap microbenchmark.

Frontend tests still emit React `act` / router future warnings; none fail.
No UI, auth/database/API contract or MCP files changed.

**Live audit blocked:** `GROQ_API_KEY` is absent. The `--live` command exits before
any provider request. Actual provider token reduction, response lengths, factual
quality, latency and the reasoning reserve have **not** been verified. Do not
interpret mocked endpoint tests as model-quality tests. Commit locally; defer
push until live verification is available and passes.

For the seven requested live examples, additionally review: arithmetic result 36;
fotosynthesis terminology appropriate for mavo 3; a difficult question staying
within mavo with no answer attached; moon explanation starting with weaker
attraction rather than advanced gravity formulas; preserved follow-up meaning;
long-history coherence. Also review havo/vwo, hints and structured generation.
The script's regex checks are only smoke checks, not educational correctness
proofs. Keep any content review private; do not add student content to logs.

---

# GPT-OSS inference settings — same day, follow-up

The prompt/context optimization above stays as it is. This follow-up changes
**how the model is called**, not how much text it gets: reasoning effort per
task, one compact level line, and an output budget that follows the effort.

## What changed

| Area                 | Before                                             | After                                                                                                                        |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `reasoning_effort`   | `low` for every GPT-OSS request                    | `low` / `medium` per task and per chat question                                                                              |
| Reasoning reserve    | fixed `+256`                                       | `+256` low, `+512` medium, `+1024` high                                                                                      |
| Model                | `openai/gpt-oss-120b`                              | unchanged (measured first, no model switch)                                                                                  |
| Level in the request | `Level: mavo 3.` in chat, set level in the context | unchanged, plus the level now also travels with evaluate/hint context                                                        |
| Factual depth        | —                                                  | one shared rule: prefer the simplest correct explanation, no unsought advanced formulas, never simplify into a factual error |
| Logging              | action/model/duration/tokens                       | + `reasoningEffort` and `reasoningTokens`                                                                                    |
| Config               | —                                                  | `GROQ_REASONING_EFFORT` (`auto` default)                                                                                     |

Prompt growth from the new simplicity rule: **+21 content tokens** for every
system prompt (free chat 169 → 190; the largest task prompt, quiz, 193 → 214).
That is the entire prompt cost of this change.

## Policy (why)

- `low` for explanations, definitions, "why" questions, greetings and hints:
  a school explanation does not need a long chain of thought, and it costs
  latency and tokens on every request.
- `medium` for problem solving (math), complex evaluation and generation: these
  are the cases where the model has to do more than restate.
- `high` is never used by default. Nothing in the measurements justifies it for
  school-level questions; `GROQ_REASONING_EFFORT=high` is available to prove
  that on a real key.
- Free chat classifies the question (`chatReasoningEffort`): "Los 3x + 7 = 22
  stap voor stap op" and "Geef één moeilijke vraag over …" get `medium`;
  "Leg fotosynthese uit op mavo 3-niveau." and "Waarom is mijn gewicht op de
  maan kleiner?" stay `low`. This is request shaping — **not** a claim about
  answer quality.
- Reasoning is never a substitute for prompt quality: the prompt stays compact,
  the level stays explicit, and the level is never promoted because a question
  is technically hard.

## Reproducible

`npx tsx backend/scripts/measure-ai.ts` now also reports the per-task reasoning
effort and the effort/ceiling of every chat case; `--live` additionally streams
the five canonical school questions and reports input/output/reasoning tokens,
TTFT and total latency per request.

Offline run after the change (content tokens, `o200k_base` proxy):

| Case                         | System | History | User | Effort | Ceiling |
| ---------------------------- | -----: | ------: | ---: | ------ | ------: |
| Hallo                        |    190 |       0 |    1 | low    |     352 |
| 15% van 240                  |    190 |       0 |    9 | low    |     456 |
| Fotosynthese, mavo 3         |    190 |       0 |   13 | low    |   1 056 |
| Moeilijke massa/gewichtvraag |    190 |       0 |   15 | medium |     792 |
| Gewicht op de maan           |    190 |       0 |    8 | low    |     576 |
| En gewicht?                  |    197 |      30 |    3 | low    |   1 056 |
| Long chat (30 input entries) |    197 |     812 |    6 | low    |   1 056 |

One fix belongs here: "Geef **één** moeilijke vraag" did not match the
single-practice-question budget because of the accent, so that question got the
full 800-token explanation budget instead of 280.

## Verification

`npm test` (472 backend + 166 frontend), `npm run lint`, `npm run typecheck`
and `npm run build` pass. New deterministic tests live in
`backend/src/ai-inference.test.ts`: reasoning per task and per chat question,
the `GROQ_REASONING_EFFORT` override, non-reasoning models receiving no
parameter, reserve and ceiling maths, level stability (mavo stays mavo, an
explicit vwo wins, no level → simple default), and prompt-size guardrails.

**Live measurement still blocked:** no `GROQ_API_KEY` is configured in this
environment, so `--live` exits before any provider call. Token counts, TTFT,
latency and answer quality above remain unverified — the tables are request
shaping, not model results.
