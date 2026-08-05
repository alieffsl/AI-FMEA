# How OpenAI Builds the FMEA Checklist — Plain-Language Guide

This document explains, in simple terms, **how the OpenAI API key is used in this project to turn raw FMEA history and engineering standards into the checklist that the app shows to users**.

It answers four questions for every step:

1. **What data goes in?**
2. **What exact instruction (prompt) is sent?**
3. **How much data travels in one single API call?**
4. **What comes back, and where is it saved?**

> A companion document, [OPENAI_CHECKLIST_GENERATION_README.md](OPENAI_CHECKLIST_GENERATION_README.md), covers the same pipeline in a more formal, reference style. This one is the walk-through version.

---

## 0. The 30-second summary

The checklist is **not** generated when a user opens the app. It is built **offline**, ahead of time, by three scripts you run manually. The app then just reads a finished database table.

```
6,485 raw FMEA records (Excel export → JSON)
        │
        │  STAGE 1 — synthesize_all_openai.ts
        │  1 OpenAI call per record (text + up to 5 photos)
        ▼
fmea_knowledge_base.learning + .final_recommendation
        │
        │  STAGE 2 — generate_checklist.ts
        │  1 OpenAI call per (tool × failure mode) group
        ▼
fmea_checklist  →  1,330 historical checklist entries
        │
        │  STAGE 3 — generate_checklist_standard.ts
        │  88 extraction calls + ~299 merge calls
        │  (adds Product Standards + Baseline Standards)
        ▼
fmea_checklist_standard  →  1,726 final entries   ← the app reads THIS
```

Three important facts:

- **The user-facing app never calls OpenAI.** `server/checklistService.ts` only runs SQL against `fmea_checklist_standard`. Zero API cost per user request.
- **Each stage feeds the next.** Stage 3 cannot run without Stage 2's output, and Stage 2 cannot run without Stage 1's output.
- **Nothing is sent in one giant blob.** Every API call is deliberately small and scoped to one record, one group, or one standard document.

---

## 1. Where the API key lives and how it is loaded

The key is stored in `migration/.env` (never committed — see [migration/.env.template](migration/.env.template) for the shape):

```env
OPENAI_API_KEY=sk-...

# Stage 1 + Stage 2 model
OPENAI_MODEL=gpt-4o-mini

# Stage 3 model and tuning
CHECKLIST_STANDARD_MODEL=gpt-5.6-terra
CHECKLIST_STANDARD_REASONING_EFFORT=low
CHECKLIST_STANDARD_EMBEDDING_MODEL=text-embedding-3-small
CHECKLIST_STANDARD_CONCURRENCY=3
```

Every script loads it the same way:

```ts
dotenv.config({ path: path.join(__dirname, '.env') });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

Stage 3 refuses to start at all if the key is missing ([generate_checklist_standard.ts:48-50](migration/generate_checklist_standard.ts#L48-L50)):

```ts
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is missing from migration/.env');
}
```

### Which model does what

| Setting | Default | Used by | Purpose |
|---|---|---|---|
| `OPENAI_MODEL` | `gpt-4o-mini` | Stage 1, Stage 2 | Reading photos, writing learnings, consolidating |
| `CHECKLIST_STANDARD_MODEL` | `gpt-5.6-terra` | Stage 3 | Extracting controls from standards, merging |
| `CHECKLIST_STANDARD_REASONING_EFFORT` | `low` | Stage 3 | Thinking depth (cost/quality dial) |
| `text-embedding-3-small` | fixed / env | Stages 2 & 3 | Turning text into number vectors for search |

---

## 2. STAGE 1 — Turn each raw FMEA record into one clean "learning"

**Script:** [migration/synthesize_all_openai.ts](migration/synthesize_all_openai.ts)
**Command:** `npm run synthesize:openai` (from `migration/`)

### What data goes in

The input file `migration/raw_fmea_data.json` holds **6,485 records**. Each record is one failure on one tool, exported from the FMEA workbook. For one API call, the script picks out only these fields:

| Field | Example | Why it's sent |
|---|---|---|
| `failureMode` | "White Mark" | The defect being analysed |
| `toolDescription` | "Doll Base Top" | Which part |
| `toyName` | "Barbie Ken X Karl" | Context only |
| `materialGate` | "ABS / sub gate" | Material context |
| `status` | "Closed" | Context only |
| `initialRecommendations[]` | free text | Evidence |
| `firstShot[].finding` | free text | Evidence |
| `firstShotActions[].text` | free text | Evidence |
| `nextShot[].recommendation` | free text | Evidence |

Plus **inspection photos**: the script queries `fmea_knowledge_base.evidence_images_base64` for the matching row and attaches **at most 5 images** at `detail: 'low'` (~85 tokens per image instead of ~765 — a deliberate cost choice, [line 46](migration/synthesize_all_openai.ts#L46)).

### What prompt is sent

Two messages. The **system message** is a ~7,300-character standing instruction that defines the engineer persona and hard rules. The most important parts:

- **Evidence priority order:** 1) inspection images, 2) shot findings and applied actions, 3) MEC comments *only* if they contain a concrete engineering decision, 4) initial recommendations.
- **"If text conflicts with images, trust the images."**
- **Ignore lists:** reference-only comments ("take a look", "refer to"), acknowledgements ("ok", "noted"), pending comments ("checking", "will update").
- **Field separation:** `learning` = the reusable concern (what happened, where, what physical condition caused it, 30-60 words). `final_recommendation` = one imperative action sentence only. They must not say the same thing.
- **Approved verbs** for the recommendation: Add, Reduce, Increase, Remove, Apply, Machine, Adjust, Replace, Relocate, Modify, Include, Set, Change, Update, Revise.
- **Dimension logic:** "0.1 mm to 0.3 mm means Increase. 0.3 mm to 0.1 mm means Reduce." — trust the numbers over the verb.
- Six good examples and seven bad examples, so the model can pattern-match.

The **user message** is built by `buildUserPrompt()` and looks like this:

```
CONTEXT ONLY - DO NOT REPEAT UNLESS NEEDED
Failure mode: White Mark
Tool description: Doll Base Top
Toy: ...
Material / gate: ...
Status: ...

RECORDED EVIDENCE

Initial recommendations:
- ...

First shot findings:
- ...

First shot actions:
- ...

Next shot findings / actions:
- ...

Task:
Use the record evidence and attached inspection images to write one
reusable engineering learning note and one final physical recommendation.
...
Return only this JSON:
{"learning":"...","final_recommendation":"..."}
```

### The exact request

```ts
openai.chat.completions.create({
  model: MODEL,                    // gpt-4o-mini
  temperature: 0.2,                // low = consistent, not creative
  max_tokens: 600,
  response_format: FMEA_RESPONSE_FORMAT,   // strict JSON schema
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: [ {type:'text', ...}, ...up to 5 images ] },
  ],
});
```

`response_format` is a **strict JSON schema** requiring exactly two string keys, `learning` and `final_recommendation`. The model physically cannot return prose or extra keys.

### How much data per submission

**One record per call.** Never two.

- System prompt: ~7,300 characters (~1,800 tokens) — identical on every call
- User prompt: typically 500–2,000 characters (~150–500 tokens)
- Images: 0–5, at ~85 tokens each in low detail
- Output cap: 600 tokens

So a typical call is roughly **2,000–2,700 input tokens**. Three records run in parallel (`CONCURRENCY=3`).

### The safety net: local validation + one repair call

The reply is parsed, then checked **in your own code, not by the model** ([validateSynthesis](migration/synthesize_all_openai.ts#L557)):

- Exactly two keys, both non-empty strings
- `learning` between 8 and 75 words
- `final_recommendation` starts with an approved verb, max 28 words
- Neither contains any of the 48 **blocked phrases** ("observed issue", "intermediate evaluations", "to improve", "ensure ", "suggest ", "verify "…)
- `learning` does not start like a command
- `learning` and `final_recommendation` are less than 72% word-overlap (not repetitive)
- `learning` does not just repeat the toy name

If any check fails, the script sends **one repair call** that includes the original prompt, the bad output, and the exact list of errors. If the repair also fails, the record is **skipped and left empty** rather than saved dirty.

### Where it's saved

```sql
UPDATE fmea_knowledge_base
SET learning = $1, final_recommendation = $2
WHERE id = $3 AND toy_num = $4 AND tool_num = $5 AND failure_mode = $6
```

The `WHERE` clause repeats the business key on purpose, so a wrong row can never be overwritten.

### Number of calls

**1 per record**, plus up to 1 repair. Re-running skips any record that already has both fields filled, unless you set `FORCE_REPROCESS=true`.

---

## 3. STAGE 2 — Consolidate many learnings into a few checklist entries

**Script:** [migration/generate_checklist.ts](migration/generate_checklist.ts)
**Command:** `npm run checklist:generate`

### What data goes in

A SQL query groups the knowledge base by **(normalized tool description × failure mode)** and keeps only groups with **2 or more records** ([lines 169-185](migration/generate_checklist.ts#L169-L185)):

```sql
SELECT tool_description_normalized, tool_category, failure_mode, COUNT(*)
FROM fmea_knowledge_base
WHERE tool_description_normalized IS NOT NULL
  AND failure_mode IS NOT NULL
  AND learning IS NOT NULL
  AND final_recommendation IS NOT NULL
  AND learning != '' AND final_recommendation != ''
GROUP BY tool_description_normalized, tool_category, failure_mode
HAVING COUNT(*) >= 2
ORDER BY COUNT(*) DESC
```

Only four columns per record are then fetched and sent: `id`, `failure_id`, `learning`, `final_recommendation`. **Raw comments, photos, toy names, and project data never reach this stage** — only the clean Stage 1 output.

### What prompt is sent

The system prompt (~2,900 characters) is aggressively anti-duplication. Its logic:

**Grouping rule** — two learnings are the *same* concern if they describe the same physical mechanism, even when the wording, project, or exact dimensions differ. They are *different* only if they have different physical root causes, affect different features, or **fixing one would not fix the other**.

**The hard limit:**
> "If you output more than 3 entries, you are probably splitting things that should be merged. Most failure modes have 1-2 true root causes, not 5-10."

**Two-step method:** first identify the 1–3 distinct physical mechanisms across *all* learnings, then write one entry per mechanism.

**Four quality checks the model must apply before answering**, including "your output should have FEWER entries than input learnings (ideally 1/3 to 1/2 as many)".

**A worked example** showing 4 input learnings collapsing to 2 output entries.

The user message packs the whole group into one payload:

```
Tool: Doll Base Top (Injection)
Failure Mode: White Mark
Total Learnings: 12

[0] Learning: ...
Recommendation: ...

[1] Learning: ...
Recommendation: ...
...
[11] Learning: ...
Recommendation: ...

Consolidate these into distinct checklist concerns. Return JSON array.
```

The numeric index `[0]`, `[1]`, … is the key trick: the model returns `supporting_indices` pointing back at those numbers, which the script converts into real database row IDs. That is how **provenance** is preserved.

### The exact request

```ts
openai.chat.completions.create({
  model: MODEL,          // gpt-4o-mini
  temperature: 0.3,
  max_tokens: 1500,
  messages: [ {role:'system', ...}, {role:'user', ...} ],
});
```

Expected reply:

```json
[
  { "concern": "...", "recommendation": "...", "supporting_indices": [0, 1, 4] },
  { "concern": "...", "recommendation": "...", "supporting_indices": [2, 3] }
]
```

### How much data per submission

**One whole group per call** — this is the stage where a single call can carry a lot.

- System prompt: ~2,900 characters (~730 tokens), constant
- User prompt: `number of learnings × ~250 characters`. A 2-record group is ~600 characters; a 40-record group is ~10,000 characters (~2,500 tokens)
- Output cap: 1,500 tokens

Groups are processed **sequentially**, with a 2-second pause every 10 groups for rate limiting.

### The embedding calls

For **every** sub-concern produced, a separate embedding call runs:

```ts
const embeddingText = `${tool_category} ${tool_description_normalized} ${failure_mode}: ${concern}`;
openai.embeddings.create({ model: 'text-embedding-3-small', input: embeddingText });
```

One string, one call — this stage does **not** batch. The resulting 1,536-number vector is stored as JSONB so the app can do semantic matching later.

### Where it's saved

`INSERT … ON CONFLICT (tool_description_normalized, failure_mode, sub_concern_index) DO UPDATE` into `fmea_checklist`, with 5 retries and pool recreation on connection failure. Result: **1,330 historical checklist entries.**

### Number of calls

Per group: **1 consolidation call + N embedding calls** (N = entries produced, usually 1–3). Groups already present in `fmea_checklist` are skipped unless `FORCE_REPROCESS=true`.

---

## 4. STAGE 3 — Add engineering standards to the historical checklist

**Script:** [migration/generate_checklist_standard.ts](migration/generate_checklist_standard.ts)
**Command:** `npm run checklist-standard:generate` (add `--dry-run`, `--extract-only`, `--force`, `--limit N`, `--source <slug>`)

This is the most careful stage, because it mixes *proven history* with *written standards* and must not damage the history.

### The three data sources

**1. Historical checklist** — all 1,330 rows from `fmea_checklist`. Two derived lists are built from it and used as the **only allowed vocabulary** later:
- every distinct tool name (`allTools`)
- every distinct failure mode, minus four non-physical ones: `Cost Saving`, `First Shot Failure`, `Next Shot Failure`, `Other`

**2. Product Standards** — `src/data/mec_product_standard_v2.json`: **74 pages, 290 sections**. Each section becomes one numbered evidence item (title + content + any table flattened to `Columns: a | b` rows).

**3. Baseline Standards** — `src/data/accessory_tooling_ai_database.json`: 18 tooling sheets. Checkpoints are **filtered before use** — anything with `confidence: 'low'` or `review_required: true` is dropped. After filtering, **14 sheets** still have usable evidence. Each checkpoint becomes one evidence item joining `requirement | acceptance_criteria | applicability | verification_method`.

**Result: 88 source documents with 366 evidence items, ~77,000 characters total.**

### Step A — Narrow the tool list *without* OpenAI

Before any API call, plain code decides which tools a document could plausibly apply to ([candidateTools](migration/generate_checklist_standard.ts#L532)):

1. Tokenize the document title and slug, dropping stop-words like "design", "guideline", "standard", "barbie", "doll", "mold".
2. Expand with synonyms — `shoe → shoe, shoes, boot, boots, booties, footwear`; `arm → arm, elbow, shoulder`.
3. Score every historical tool name: exact match = 8 points, substring match = 3 points.
4. Keep the **top 40**.

This is the single biggest cost saver. Instead of sending hundreds of tool names, each call carries at most 40 — and the model is *forbidden* to invent any name outside that list.

### Step B — One extraction call per standard document

**Instruction (~2,700 characters), the important rules:**

- Return only explicit, actionable engineering controls that the supplied evidence supports.
- **"Do not invent a failure, mechanism, dimension, material, limit, or applicability."**
- Skip overview, catalog, sourcing, and model-list content.
- **"Most sources should produce 0-3 controls; 6 is a hard maximum."**
- A specific failure mode is allowed **only when the evidence explicitly names that defect or a direct synonym**. Example given: "a hole dimension alone does not prove Short shot, and a wall-thickness value alone does not prove Sink mark."
- If there's a dimension requirement with no stated defect, use `Improper function` / `Improper Assembly` and **do not invent a downstream mechanism**.
- Recommendations must start with a listed action verb, and **must not start with "Ensure."**
- `supporting_indices` must cite every evidence item used.

**Input format:**

```
SOURCE TYPE: product_standard
SOURCE ID: product:barbie-arm-tool-design
TITLE: Barbie Arm Tool Design
SOURCE FILE: ...

ALLOWED TOOL NAMES:
- Arm RT
- Arm LT
- Elbow Connector
... (max 40)

ALLOWED FAILURE MODES:
- Bending
- Deformed
... (~35)

SOURCE EVIDENCE:
[0] Section heading
Section text...

[1] Next heading
...
```

**Request shape** — this stage uses the **Responses API** with strict structured output, not chat completions:

```ts
openai.responses.create({
  model: MODEL,                          // gpt-5.6-terra
  reasoning: { effort: 'low' },
  instructions,                          // the rules above
  input,                                 // the block above
  max_output_tokens: 5000,
  text: {
    verbosity: 'low',
    format: { type: 'json_schema', name, strict: true, schema: EXTRACTION_SCHEMA },
  },
});
```

`EXTRACTION_SCHEMA` enforces `maxItems: 6`, `additionalProperties: false`, and locks `applicability_scope` to `exact_tool | global_process` and `confidence` to `high | medium`.

**How much data per submission (measured on the real data):**

| | Characters | ≈ Tokens |
|---|---|---|
| Instructions (constant) | 2,682 | ~670 |
| Allowed tool names (≤40) | ~600 | ~150 |
| Allowed failure modes (~35) | ~700 | ~175 |
| Evidence — **average** source | 880 | ~220 |
| Evidence — **median** source | 813 | ~200 |
| Evidence — **largest** source (`baseline:tooling-baseline-headband`, 14 items) | 3,729 | ~930 |
| **Typical total input** | **~4,900** | **~1,200** |
| **Worst-case total input** | **~7,700** | **~1,900** |

Individual evidence items average 181 characters and never exceed 1,012. Three documents are extracted in parallel (`CONCURRENCY=3`).

### Step C — The validate-and-retry loop (the quality core)

Every structured reply passes through `structuredResponse()`, which runs your own validator and, on failure, **re-sends the same prompt with the error list appended** ([lines 400-439](migration/generate_checklist_standard.ts#L400-L439)):

```ts
input: feedback
  ? `${input}\n\nVALIDATION FEEDBACK FROM PRIOR ATTEMPT:\n${feedback}`
  : input
```

Up to **4 attempts** (`MAX_ATTEMPTS`), with a backoff of `attempt × 1200 ms`.

What the extraction validator rejects:

| Check | Rejects when |
|---|---|
| Failure mode allow-list | Model used a mode not in the supplied list |
| Tool allow-list | Model invented a tool name, or used `global_process` when tool names were available |
| Evidence index | `supporting_indices` points at a non-existent item |
| Verb style | Recommendation starts with "Ensure", "The", "This", "It", "There" |
| **Defect-term proof** | The cited evidence text doesn't contain a required keyword for that failure mode. `Sink mark` needs the words "sink mark"/"sink"; `Weldline` needs "weld line"/"weldline"; `Short shot` needs "short shot"/"incomplete fill". Defined in `FAILURE_EVIDENCE_TERMS` (31 modes). |
| **Number grounding** | Any number in the concern or recommendation that does not appear in the cited evidence. A hallucinated "0.5 mm" is caught mechanically. |
| Duplication | Two controls with ≥0.72 word-overlap on concern, or ≥0.78 on recommendation (Jaccard) |

**Result on the last real run: 88 documents → 131 controls.** Roughly 40% of documents legitimately produce **zero** controls, and that is treated as success, not failure.

### Step D — Fan out, then one merge call per affected group

Each extracted control names one failure mode and possibly many tools. The script fans it out:

```
control(tool_names: [Arm RT, Arm LT, Elbow Connector], failure_mode: Improper Assembly)
   → key "Arm RT||Improper Assembly"
   → key "Arm LT||Improper Assembly"
   → key "Elbow Connector||Improper Assembly"
```

That is why **131 controls produced 306 product-standard entries** — one written rule legitimately applies to many tools. Global controls fan out to the single key `*`.

**Only groups touched by a standard go to OpenAI.** Every other historical group is copied through by `historicalToFinal()` with **zero API cost and zero wording change**. Last run: **299 affected groups** out of ~1,000+.

**Merge instruction (~1,700 characters), the important rules:**

- **"Treat each historical entry as an immutable quality anchor rather than reconsolidating historical entries with each other."**
- Keep every historical concern represented **exactly once**.
- Preserve historical wording **verbatim** when the standards add nothing new.
- Merge a standard into an existing entry when both address the same physical mechanism; create a new entry only when fixing one would not fix the other.
- Normally 1–3 entries out. Never invent numbers. Never lengthen wording just to mention both sources.
- Each output entry may reference **at most one** historical index.

**Input format:**

```
TOOL: Arm RT
FAILURE MODE: Improper Assembly
MAXIMUM OUTPUT ENTRIES: 5

HISTORICAL CHECKLIST INPUTS:
[H0] Concern: ...
Recommendation: ...

[H1] Concern: ...
Recommendation: ...

STANDARD INPUTS:
[S0] product_standard / Barbie Arm Tool Design
Concern: ...
Recommendation: ...
Evidence: Section heading: <up to 800 characters of the original text> | ...
```

Note `MAXIMUM OUTPUT ENTRIES`, computed in code as `min(12, historical.length + min(3, standards.length))` — the model is told its own budget, so it cannot inflate the checklist.

**How much data per submission:**

- Instructions: 1,742 characters (~440 tokens), constant
- Each historical input: ~200 characters
- Each standard input: ~250 characters **plus up to 800 characters of verbatim source excerpt per reference**
- Typical group (2 historical + 1 standard): **~3,000 characters (~750 tokens)**
- Heavy group (6 historical + 3 standards): **~7,000 characters (~1,750 tokens)**
- Output cap: 5,000 tokens

**Merge validator** — everything from the extraction validator, plus:

- **Coverage:** every historical input `H0…Hn` must appear in **exactly once**. Not zero, not twice. If not, the whole attempt is rejected.
- **No multi-anchor entries:** one entry cannot combine `H0` and `H1`.
- **Automatic verbatim restore:** if an entry cites one historical index and no standard index, the code **overwrites the model's text with the original wording** instead of spending another call asking for an exact copy ([lines 732-738](migration/generate_checklist_standard.ts#L732-L738)).
- Output count never exceeds the stated `MAXIMUM OUTPUT ENTRIES`.

**The fallback that guarantees no data loss:** if all 4 attempts fail, the code does **not** crash or skip. It builds the merge itself — copy every historical entry through unchanged, then append any non-duplicate standard controls that fit in the remaining slots. History always survives.

### Step E — Batched embeddings

Unlike Stage 2, Stage 3 batches **100 texts per call**:

```ts
openai.embeddings.create({
  model: 'text-embedding-3-small',
  input: batch.map(row =>
    `${row.tool_description_normalized} ${row.failure_mode}: ${row.concern} ${row.recommendation}`),
});
```

Only rows **without** an embedding are sent. Untouched historical rows already carry their Stage 2 vector and are skipped, so only the ~600 merged rows need new embeddings → roughly **6 calls**, not 1,726.

### Step F — Final validation, then atomic table swap

Before anything is written, `validateFinalRows()` throws if:

- any `(tool, failure_mode, sub_concern_index)` key is duplicated
- any concern or recommendation is empty
- any row claims a standard source but carries no `supporting_standard_refs`
- **any original `fmea_checklist` row ID is missing from the output** — the strongest guarantee in the pipeline

Then the write happens inside a single transaction:

```sql
BEGIN;
TRUNCATE TABLE fmea_checklist_standard;
INSERT … (1,726 rows);
COMMIT;              -- ROLLBACK on any error
```

**`fmea_checklist` is never touched.** It stays as the rollback point.

---

## 5. Real numbers from the last production run

From `migration/checklist_standard_work/gpt-5-6-terra/latest-report.json`, generated **2026-07-28**:

| Metric | Value |
|---|---|
| Model | `gpt-5.6-terra`, reasoning effort `low` |
| Prompt version | `checklist-standard-v3` |
| Concurrency | 3 |
| Historical entries in | 1,330 |
| Standard sources in | 88 |
| Controls extracted | 131 |
| Affected tool × failure groups | 299 |
| **Final entries out** | **1,726** |
| — with a Product Standard source | 306 |
| — with a Baseline Standard source | 131 |
| — global process scope | 3 |
| Historical entries lost | **0** |

### Total API calls, worst case, for a cold full run of Stage 3

| Step | Calls |
|---|---|
| Extraction | 88 (up to 352 with maximum retries) |
| Merge | 299 (up to 1,196 with maximum retries) |
| Embeddings | ~6 (batches of 100) |
| **Total** | **~393 on a clean run** |

Stages 1 and 2 are far larger: Stage 1 is ~6,485 calls, Stage 2 is one call per group plus one embedding per entry. That is exactly why they are run once and never repeated.

---

## 6. Caching — why re-running is nearly free

Stage 3 writes every model reply to disk under `migration/checklist_standard_work/<model>/`:

```
extractions/<source-id>-<hash12>.json   ← one file per document
merges/<tool-failure>-<hash12>.json     ← one file per merged group
latest-report.json                      ← run summary
```

The filename hash covers **the source content, the candidate tool list, the failure-mode list, and the prompt version**. So:

- Re-run with nothing changed → **every cache hit, zero OpenAI calls**, database rebuilt from disk.
- Edit one standard document → only that document's hash changes → **1 extraction call**, plus merge calls for the groups it touches.
- Bump `PROMPT_VERSION` → **every hash changes**, full regeneration.
- Pass `--force` → cache ignored entirely.

The cache folders currently hold 95 extraction files and 313 merge files — more than the 88 and 299 of the last run, because earlier attempts with different inputs left their own entries behind. Stale files are harmless; they are simply never looked up again.

---

## 7. What is sent to OpenAI, and what never is

**Sent:**

- Synthesized `learning` and `final_recommendation` text (Stages 2 and 3)
- Tool description names and failure mode names
- Product Standard section text and tables
- Baseline Standard checkpoint text
- In Stage 1 only: raw trial comments, material/gate text, toy names, and up to 5 inspection photos per record

**Never sent:**

- Database credentials, connection strings, or the contents of `.env`
- Row UUIDs and failure IDs — these stay local; the model only ever sees positional indices `[0]`, `[1]`, `[H0]`, `[S0]`
- Embedding vectors
- Any inspection photo after Stage 1 — Stages 2 and 3 are text-only
- Anything at all during normal app usage

That last point is worth repeating: `server/checklistService.ts` sets `const CHECKLIST_TABLE = 'fmea_checklist_standard'` and runs SQL. **A user opening the app triggers no OpenAI call and costs nothing.**

---

## 8. How to run it safely

Run the stages in order, and always inspect before writing:

```bash
cd migration

# --- Stage 1 (only for new raw records) ---
TEST_MODE=true TEST_SIZE=20 npm run synthesize:openai   # sample first
npm run synthesize:openai                               # full run

# --- Stage 2 (only for new tool/failure groups) ---
TEST_MODE=true TEST_SIZE=10 npm run checklist:generate
npm run checklist:generate
npm run checklist:verify

# --- Stage 3 (the one you will re-run most) ---
npm run checklist-standard:generate -- --extract-only          # see controls, no DB write
npm run checklist-standard:generate -- --dry-run               # full pipeline, no DB write
npm run checklist-standard:generate -- --source <slug>         # one document only
npm run checklist-standard:generate                            # write to DB
npm run checklist-standard:verify                              # confirm the result
```

`checklist-standard:verify` is the acceptance gate. It checks total entries, entries carrying standard provenance, key duplicates, content duplicates, empty rows, and **historical rows missing from the combined table** — that last count must be `0`.

**Ordering rules that matter:**

- Never run Stage 3 while Stage 2 is still writing. Stage 3 reads `fmea_checklist` as a fixed snapshot.
- Always `--dry-run` before a real write. The write is a `TRUNCATE` + reload.
- If a run goes wrong, `fmea_checklist` is untouched — re-run Stage 3 from the last good cache to rebuild.

---

## 9. Two things to watch

**Concurrency and rate limits.** `CHECKLIST_STANDARD_CONCURRENCY=3` is conservative. Raising it speeds up the run but a 429 burns retry attempts from the same `MAX_ATTEMPTS=4` budget as validation failures — so a rate-limited group can silently land in the code fallback instead of a real merge. Watch for `[Merge fallback]` lines in the log.

**Number grounding is exact-match, not semantic.** `getNumbers()` normalizes with `String(Number(x))`, so `0.50` and `.5` both become `0.5` and match. But a value derived by arithmetic — a total the model computed from two source numbers — will be rejected as unsupported. This is intentionally strict: it prevents a fabricated dimension from ever reaching an engineer's checklist.

---

## 10. File map

| File | Role |
|---|---|
| [migration/synthesize_all_openai.ts](migration/synthesize_all_openai.ts) | Stage 1 — records → learnings (vision) |
| [migration/generate_checklist.ts](migration/generate_checklist.ts) | Stage 2 — learnings → historical checklist |
| [migration/generate_checklist_standard.ts](migration/generate_checklist_standard.ts) | Stage 3 — + standards → final checklist |
| [migration/create_checklist_table.sql](migration/create_checklist_table.sql) | `fmea_checklist` schema |
| [migration/create_checklist_standard_table.sql](migration/create_checklist_standard_table.sql) | `fmea_checklist_standard` schema |
| [migration/verify_checklist.ts](migration/verify_checklist.ts) | Stage 2 acceptance checks |
| [migration/verify_checklist_standard.ts](migration/verify_checklist_standard.ts) | Stage 3 acceptance checks |
| [migration/.env.template](migration/.env.template) | Required environment variables |
| [src/data/mec_product_standard_v2.json](src/data/mec_product_standard_v2.json) | Product Standards source (74 pages) |
| [src/data/accessory_tooling_ai_database.json](src/data/accessory_tooling_ai_database.json) | Baseline Standards source (18 sheets) |
| [server/checklistService.ts](server/checklistService.ts) | Runtime reader — SQL only, no OpenAI |
