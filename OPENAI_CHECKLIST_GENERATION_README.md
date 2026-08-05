# OpenAI checklist generation: complete technical guide

This document explains exactly how this repository uses an OpenAI API key to prepare checklist data. It covers the two main generators:

- `migration/generate_checklist.ts` — creates the historical checklist table, `fmea_checklist`.
- `migration/generate_checklist_standard.ts` — preserves the historical checklist and enriches it with Product Standards and Baseline Standards in `fmea_checklist_standard`.

It also explains the upstream `migration/synthesize_all_openai.ts` step because that script can create the `learning` and `final_recommendation` fields consumed by the historical checklist generator.

The key architectural fact is:

> OpenAI is used offline to prepare reusable database content. The normal application and Draft FMEA request path do not send each user's project to OpenAI.

The runtime server reads the already-generated `fmea_checklist_standard` PostgreSQL table. It performs database and local fuzzy-text matching in `server/checklistService.ts`; it does not need `OPENAI_API_KEY`.

## 1. End-to-end data flow

```text
Historical FMEA records
        |
        | optional upstream AI synthesis, one record per request
        | synthesize_all_openai.ts
        v
fmea_knowledge_base
  - tool_description_normalized
  - tool_category
  - failure_mode
  - learning
  - final_recommendation
        |
        | AI consolidation, one tool/failure group per request
        | generate_checklist.ts
        v
fmea_checklist (historical baseline)
        |
        |                    Product Standards JSON
        |                    Baseline Standards JSON
        |                              |
        |              AI extraction, one source per request
        |                              v
        +---------- AI merge by tool/failure group
                                   |
                                   v
                    fmea_checklist_standard
                                   |
                                   | runtime PostgreSQL lookup;
                                   | no OpenAI request
                                   v
                         Draft FMEA checklist rows
```

There are therefore three distinct AI jobs:

1. Optional record synthesis: turn one raw historical FMEA record, and up to five evidence images by default, into `learning` plus `final_recommendation`.
2. Historical consolidation: turn all eligible learnings for one normalized tool and failure mode into a small historical checklist.
3. Standards enrichment: extract controls from one standard at a time, merge them into affected historical groups, and embed the final rows.

## 2. API key setup and use

Create the local migration environment file:

```powershell
Copy-Item migration\.env.template migration\.env
```

Set at least the PostgreSQL values and the OpenAI key:

```dotenv
PG_HOST=your_postgresql_host
PG_PORT=5432
PG_USER=your_postgresql_user
PG_PASSWORD=your_postgresql_password
PG_DATABASE=your_postgresql_database

OPENAI_API_KEY=your_secret_key
```

Optional model configuration:

```dotenv
# Historical record synthesis and historical checklist consolidation
OPENAI_MODEL=gpt-4o-mini

# Combined historical + standards checklist
CHECKLIST_STANDARD_MODEL=gpt-5.6-terra
CHECKLIST_STANDARD_REASONING_EFFORT=low
CHECKLIST_STANDARD_EMBEDDING_MODEL=text-embedding-3-small
CHECKLIST_STANDARD_CONCURRENCY=3
CHECKLIST_STANDARD_RETRY_ATTEMPTS=4
```

The code constructs the SDK client on the migration machine:

```ts
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

The key authenticates HTTPS requests made by the official `openai` Node package. It is not inserted into a prompt and is not stored in either checklist table.

Security rules:

- Keep the key only in `migration/.env` or a protected secret manager/environment variable.
- Never put the key in frontend code or a variable beginning with `VITE_`; those variables can be bundled into browser assets.
- Never commit `migration/.env`. The repository's `.gitignore` excludes `.env` files.
- Do not paste the key into logs, screenshots, tickets, reports, or this README.
- The deployed runtime API does not require this key. Only the offline migration/generation environment needs it.
- Treat the engineering text and images sent to the model as potentially confidential. Confirm that the selected API account/project and organizational data controls are appropriate before running a pipeline.

Configuration-loading difference:

- `generate_checklist.ts` calls `dotenv.config()` and therefore expects `.env` in its process working directory. Running it through `npm --prefix migration ...` places it in the intended migration context.
- `generate_checklist_standard.ts` and `synthesize_all_openai.ts` explicitly load `migration/.env` based on their own file location.
- `generate_checklist_standard.ts` fails immediately with a clear error when `OPENAI_API_KEY` is absent. `generate_checklist.ts` relies on the SDK to report a missing key.

## 3. Pipeline A: historical checklist generation

### 3.1 Command

Create the table if required, generate it, and verify it:

```powershell
npm --prefix migration run checklist:create
npm --prefix migration run checklist:generate
npm --prefix migration run checklist:verify
```

Useful environment controls:

```dotenv
OPENAI_MODEL=gpt-4o-mini
TEST_MODE=true
TEST_SIZE=10
FORCE_REPROCESS=false
```

- `TEST_MODE=true` limits the list to the first `TEST_SIZE` groups after database selection and filtering.
- `FORCE_REPROCESS=false` skips a tool/failure pair when any row for that pair already exists in `fmea_checklist`.
- `FORCE_REPROCESS=true` submits all eligible groups again and upserts their generated row indexes.

### 3.2 Which database rows are used

The script queries `fmea_knowledge_base`. A row is eligible only when all of these are true:

- `tool_description_normalized` is not null;
- `failure_mode` is not null;
- `learning` is not null or empty;
- `final_recommendation` is not null or empty.

Rows are grouped by this exact triple:

```text
tool_description_normalized × tool_category × failure_mode
```

Only groups containing at least two records are processed (`HAVING COUNT(*) >= 2`). The records fetched for a group contribute these database fields:

| Field | Sent to the chat model? | Later database use |
|---|---:|---|
| `learning` | Yes | Source text for consolidation |
| `final_recommendation` | Yes | Source action for consolidation |
| `tool_description_normalized` | Yes | Prompt context, grouping, and output row |
| `tool_category` | Yes, when present | Prompt context and output row |
| `failure_mode` | Yes | Prompt context, grouping, and output row |
| `id` | No | Provenance in `supporting_record_ids` |
| `failure_id` | No | Provenance in `supporting_failure_ids` |

The script does not send raw FMEA rows, project names, database credentials, or images in this consolidation request unless such information is already written inside `learning` or `final_recommendation`.

### 3.3 How much data is used in one submission

One Chat Completions request contains exactly one eligible group and every record in that group. There is no record-count cap and no input-character/token truncation in the script.

For `N` records, the dynamic evidence body is:

```text
[0] Learning: <record 0 learning>
Recommendation: <record 0 final_recommendation>

[1] Learning: <record 1 learning>
Recommendation: <record 1 final_recommendation>

... through record N-1
```

Current measured database snapshot on 3 August 2026:

| Measurement | Value |
|---|---:|
| Eligible groups | 658 |
| Records across eligible groups | 2,114 |
| Records in one request | minimum 2, median 2, average 3.21, maximum 21 |
| Learning + recommendation characters in one group | minimum 233, median 545, average 702.9, maximum 3,880 |

The character measurements exclude the fixed system prompt, labels, tool name, category, failure mode, and JSON/API framing. Characters are not tokens. Actual input tokens depend on the selected model's tokenizer, and this code does not currently record token usage.

### 3.4 Exact consolidation instruction

The system message hard-coded in `generate_checklist.ts` is:

```text
You are an FMEA engineering expert. You will receive multiple learnings about the same failure mode on the same tool/part. Your job is to consolidate them into the SMALLEST possible set of distinct, non-redundant checklist entries.

GROUPING RULE:
Two learnings belong in the SAME group if they describe the SAME underlying physical mechanism, even if:
- The wording is different
- The project names are different
- The exact dimensions vary slightly
- One is more specific than the other

Two learnings belong in DIFFERENT groups ONLY if:
- They describe different physical root causes (e.g., "insufficient draft" vs "sink marks")
- They affect different physical features/areas of the part
- Fixing one would NOT fix the other

CRITICAL: Your goal is AGGRESSIVE CONSOLIDATION. If you output more than 3 entries, you are probably splitting things that should be merged. Most failure modes have 1-2 true root causes, not 5-10.

STEP 1 — Identify TRUE root causes:
- Read ALL learnings first
- Identify the 1-3 DISTINCT physical mechanisms causing this failure mode
- Assign ALL learnings to one of these root causes (most learnings will share the same root cause)

STEP 2 — Write ONE entry per root cause:
- concern: One concise sentence describing the root cause mechanism. Use engineering language, not project-specific details. Example: "Insufficient draft causes core sticking and visible marks during demold" NOT "The Doll Base Top had a white mark near the hinge and the Bracelet had scratches"
- recommendation: One short imperative sentence starting with action verb (Add/Reduce/Increase/Remove/Modify/Review). Be specific. If dimensions are mentioned, use the most conservative value.
- supporting_indices: ALL learning indices that share this root cause

QUALITY CHECKS (apply before returning):
1. If you have 4+ entries, re-read them — can any be merged because they describe the same mechanism?
2. If two "concern" sentences sound similar or use similar technical words, merge them
3. If two "recommendation" sentences suggest the same action, merge them
4. Your output should have FEWER entries than input learnings (ideally 1/3 to 1/2 as many)

WORKED EXAMPLE:
Input (4 learnings):
0: "White mark near the hinge, insufficient draft on the core."
1: "Scratch marks on demold, core sticking, draft angle too shallow."
2: "Rough surface texture on the outer face, visible under light."
3: "Surface finish inconsistent, sink marks near the gate."

Correct output (2 entries, not 4):
[
  { "concern": "Insufficient draft on core surfaces causes sticking and visible marks during demold.", "recommendation": "Add 0.5 degree minimum draft to all core surfaces.", "supporting_indices": [0, 1] },
  { "concern": "Inconsistent surface finish and sink marks near the gate.", "recommendation": "Review wall thickness and cooling near the gate to reduce sink marks.", "supporting_indices": [2, 3] }
]

Return ONLY the JSON array:
[
  {
    "concern": "...",
    "recommendation": "...",
    "supporting_indices": [0, 1, 2]
  }
]
```

The user message for each group is constructed as:

```text
Tool: <normalized tool> (<category, only when present>)
Failure Mode: <failure mode>
Total Learnings: <N>

<all indexed learning/recommendation pairs>

Consolidate these into distinct checklist concerns. Return JSON array.
```

### 3.5 Exact OpenAI request shape

```ts
openai.chat.completions.create({
  model: OPENAI_MODEL ?? "gpt-4o-mini",
  messages: [
    { role: "system", content: CONSOLIDATION_PROMPT },
    { role: "user", content: userPrompt },
  ],
  temperature: 0.3,
  max_tokens: 1500,
});
```

This older generator requests ordinary text and manually strips optional Markdown code fences before `JSON.parse`. It does not use a strict JSON schema and does not validate that every input index is covered, that an index is in range, or that numerical claims came from the evidence.

### 3.6 Embedding request and database write

After one checklist concern is generated, a separate embedding request is made:

```ts
openai.embeddings.create({
  model: "text-embedding-3-small",
  input: "<category> <normalized tool> <failure mode>: <concern>",
});
```

The recommendation is not included in this historical embedding text. Embeddings are requested one checklist entry at a time, not in batches.

For each output concern, the script maps `supporting_indices` back to the database rows and stores:

- generated `concern` and `recommendation`;
- count of cited records;
- cited source UUIDs and failure IDs;
- the embedding array;
- tool, category, failure mode, and a one-based `sub_concern_index`.

The insert uses `ON CONFLICT (tool_description_normalized, failure_mode, sub_concern_index) DO UPDATE`.

### 3.7 Number of API calls

For `G` groups and `E` generated checklist entries:

```text
Chat generation requests = G
Embedding requests       = E
Total requests           = G + E
```

Calls are sequential. The script pauses for two seconds after every ten groups. That pause is a simple throttle, not an adaptive response to actual rate-limit headers.

The current table contains 655 tool/failure groups and 1,330 checklist entries. A fresh run that happened to reproduce exactly that output shape would therefore make approximately 655 chat requests plus 1,330 individual embedding requests. Model output is nondeterministic, so the future number of generated entries is not guaranteed.

The current source query finds 658 eligible groups while the table contains 655 groups. Also, the source query sees 2,114 records while stored checklist provenance totals 2,075 references. The generator does not enforce complete index coverage, and a per-group API/parse/database error is logged and skipped, so these differences must be investigated rather than assumed to be intentional.

## 4. Pipeline B: combined historical + standards generation

### 4.1 Commands

Small database-safe test:

```powershell
npm --prefix migration run checklist-standard:generate -- --dry-run --limit 5
```

One source:

```powershell
npm --prefix migration run checklist-standard:generate -- --dry-run --source headband-design-guidelines
```

Extraction only:

```powershell
npm --prefix migration run checklist-standard:generate -- --extract-only --limit 5
```

Full generation and verification:

```powershell
npm --prefix migration run checklist-standard:generate
npm --prefix migration run checklist-standard:verify
```

Force fresh extraction and merging:

```powershell
npm --prefix migration run checklist-standard:generate -- --force
```

Important behavior:

- `--dry-run` prevents the final database replacement, but it does **not** prevent OpenAI generation or embedding calls.
- `--extract-only` stops before merge calls, embeddings, final validation, and table replacement. Extraction calls can still be billable.
- `--limit N` limits standard sources, not historical rows or output rows.
- `--source X` selects an exact source slug or internal source ID.
- `--force` ignores extraction and merge caches. It does not bypass validation.

### 4.2 Data source 1: historical checklist

The script reads every row from `fmea_checklist`, including:

- tool, category, and failure mode;
- concern and recommendation;
- supporting record IDs and failure IDs;
- S/O/D defaults when present;
- existing embedding and verification fields.

Every historical row must survive in the final result. Unaffected rows are copied locally without a generation request and retain their existing embeddings. Affected rows are provided to the merge model as immutable anchors.

Four failure modes are excluded from the allowed standards-extraction list:

```text
Cost Saving
First Shot Failure
Next Shot Failure
Other
```

In the current snapshot, `fmea_checklist` supplies 250 distinct normalized tools and 35 allowed failure modes after those exclusions.

### 4.3 Data source 2: Product Standards

Files read locally:

- `src/data/mec_product_standard_v2.json`
- `src/data/sourceMapping.json`

One Product Standard page becomes one `StandardSource`. For each section, the loader creates one evidence item containing:

- zero-based evidence index;
- section title;
- compacted section content;
- flattened table text in `Columns: ...` plus row form;
- reference such as `section:1`.

Empty sections are removed. Images, PDFs, PowerPoint files, and source document bytes are not loaded or sent by this generator. Only text already extracted into the JSON, plus source metadata and the mapped source filename, is submitted.

### 4.4 Data source 3: Baseline Standards

File read locally:

- `src/data/accessory_tooling_ai_database.json`

One standard becomes one `StandardSource`. A checkpoint is included only when:

```text
confidence != "low" AND review_required is false
```

The evidence text joins these fields when present:

- `requirement`;
- `acceptance_criteria`;
- `applicability`;
- `verification_method`.

Checkpoint images and other fields are not sent by this generator. The source workbook and sheet name are sent as source metadata.

### 4.5 Stage 1: tool candidate selection is local

Before asking the model to extract a standard, the script locally narrows the list of permitted tools:

1. Tokenize the standard title and slug.
2. Remove generic tokens such as `design`, `guideline`, `standard`, `doll`, `tool`, and `mold`.
3. Expand known families, for example `crown -> crown, tiara` and `shoe -> shoe, shoes, boot, boots, booties, footwear`.
4. Score historical tool names by exact and partial token matches.
5. Send only positive-scoring tools, sorted by score, with a hard cap of 40.

This is not an embedding/vector search. It is deterministic string matching in local code.

If candidate tools exist, the model must use `exact_tool` and may return only names in that list. If there are no candidates, only a truly general `global_process` control may be returned.

### 4.6 Stage 2: one extraction request per standard source

One Responses API request contains one complete filtered `StandardSource`; standards are not combined into one extraction call.

The dynamic input template is:

```text
SOURCE TYPE: <product_standard or baseline_standard>
SOURCE ID: <source ID>
TITLE: <title>
SOURCE FILE: <mapped file/workbook and sheet>

ALLOWED TOOL NAMES:
- <zero to 40 locally selected tool names>

ALLOWED FAILURE MODES:
- <every allowed historical failure mode>

SOURCE EVIDENCE:
[0] <heading>
<compacted evidence text>

[1] <heading>
<compacted evidence text>
```

The exact extraction instruction hard-coded in the current generator is:

```text
Role: Mechanical tooling FMEA standards editor.

Goal: Convert one Product Standard or Baseline Standard into the smallest useful set of source-grounded checklist controls that can complement an existing historical FMEA checklist.

Success criteria:
- return only explicit, actionable engineering controls supported by the supplied evidence;
- map each control to one allowed failure mode and, for exact applicability, only allowed tool names;
- preserve exact dimensions, materials, formulas, and limits from evidence;
- combine repeated wording that describes the same physical mechanism;
- use the same natural engineering style as the existing checklist.

Constraints:
- Do not invent a failure, mechanism, dimension, material, limit, or applicability.
- Skip overview, catalog, sourcing, model-list, and descriptive content without a reusable design or tooling control.
- Most sources should produce 0-3 controls; 6 is a hard maximum.
- Use global_process only when no allowed tool names are supplied and the evidence explicitly applies across injection-molded tools or a general process. Global controls enrich an already-known failure; they do not create a new failure for every tool.
- When allowed tool names are supplied, use exact_tool for every returned control and select only the names whose part/tool family matches the evidence. Return only names from ALLOWED TOOL NAMES.
- Use only a failure mode from ALLOWED FAILURE MODES.
- A specific failure mode is allowed only when the evidence explicitly names that defect or its direct synonym. For example, a hole dimension alone does not prove Short shot, and a wall-thickness value alone does not prove Sink mark.
- Evidence that explicitly says a control prevents or avoids a defect directly supports that defect.
- For an explicit dimension, material, geometry, or fit requirement with no stated defect, use Improper function or Improper Assembly and describe the nonconforming condition without inventing a downstream mechanism. Omit it if even that relationship is unclear.
- A concern is one concise physical risk statement. Avoid project storytelling and phrases such as "the standard says."
- A recommendation is one concise imperative sentence beginning with a direct engineering action verb such as Add, Adjust, Align, Apply, Avoid, Check, Control, Design, Increase, Limit, Locate, Maintain, Modify, Orient, Place, Provide, Reduce, Relocate, Remove, Review, Select, Set, Size, Specify, Test, Use, Validate, or Verify.
- Do not begin a recommendation with "Ensure."
- supporting_indices must cite every evidence item used for the control.
- Omit a control when its source support or applicability is uncertain.

Stop after the smallest complete, non-redundant set is represented in the required JSON schema.
```

The response must match a strict JSON schema:

```json
{
  "controls": [
    {
      "applicability_scope": "exact_tool",
      "tool_names": ["Headband"],
      "tool_category": "accessory",
      "failure_mode": "Sharp point",
      "concern": "...",
      "recommendation": "...",
      "supporting_indices": [0],
      "confidence": "high"
    }
  ]
}
```

Schema and code limits:

- zero to six controls per source;
- scope is `exact_tool` or `global_process`;
- confidence is `high` or `medium` only;
- at least one evidence index per control;
- no undeclared JSON properties.

### 4.7 Extraction request shape

All structured extraction and merge calls go through this request:

```ts
openai.responses.create({
  model: CHECKLIST_STANDARD_MODEL ?? "gpt-5.6-terra",
  reasoning: { effort: CHECKLIST_STANDARD_REASONING_EFFORT ?? "low" },
  instructions,
  input,
  max_output_tokens: 5000,
  text: {
    verbosity: "low",
    format: {
      type: "json_schema",
      name: "standard_checklist_controls", // merge uses another name
      strict: true,
      schema,
    },
  },
});
```

### 4.8 Extraction validation and repair

Strict schema output is followed by local semantic validation. The code rejects:

- failure modes outside the allowed list;
- missing, global, or invented tool applicability when candidates were supplied;
- invalid evidence indexes;
- non-imperative recommendations and recommendations beginning with `Ensure`;
- defect mappings that lack an explicit defect/synonym in cited evidence for mapped defect types;
- numbers in the concern/recommendation that do not occur in cited evidence;
- likely duplicate controls based on Jaccard word similarity.

When validation fails, the next API request resends the complete original input and appends:

```text
VALIDATION FEEDBACK FROM PRIOR ATTEMPT:
<local validation errors or API error>
```

`CHECKLIST_STANDARD_RETRY_ATTEMPTS` defaults to 4 and is forced to a minimum of 2. This value is total attempts, not “four retries after the first request.” Therefore one logical extraction or merge job can make up to four full Responses API submissions by default.

### 4.9 Stage 3: one merge request per affected tool/failure group

Extracted controls are grouped by:

```text
tool_description_normalized × failure_mode
```

Global controls use the special tool key `*`. Only groups affected by at least one extracted standard control receive a merge request. Historical groups with no standard control are copied without a merge request.

One merge submission contains:

- one tool name and one failure mode;
- every historical checklist entry in that exact group;
- every extracted standard control assigned to that group;
- the source title and source type for each standard control;
- cited source evidence excerpts, each truncated locally to 800 characters;
- the calculated maximum number of output entries.

The dynamic merge input is:

```text
TOOL: <tool or *>
FAILURE MODE: <failure mode>
MAXIMUM OUTPUT ENTRIES: <calculated maximum>

HISTORICAL CHECKLIST INPUTS:
[H0] Concern: <historical concern>
Recommendation: <historical recommendation>

STANDARD INPUTS:
[S0] <source type> / <source title>
Concern: <extracted concern>
Recommendation: <extracted recommendation>
Evidence: <section>: <source excerpt>
```

The output maximum is:

```ts
min(12, max(1, historicalCount + min(3, standardCount)))
```

The exact merge instruction hard-coded in the current generator is:

```text
Role: Mechanical tooling FMEA checklist editor.

Goal: Preserve the cohesion, coherence, format, and natural engineering voice of an existing historical checklist while integrating only distinct, source-grounded Product/Baseline Standard controls.

Success criteria:
- keep every historical concern represented exactly once;
- treat each historical entry as an immutable quality anchor rather than reconsolidating historical entries with each other;
- preserve an existing historical concern and recommendation verbatim when standards add no distinct requirement;
- merge a standard into an existing entry when both address the same physical mechanism;
- create a separate entry only when fixing one mechanism would not fix the other;
- use the smallest non-redundant set, normally 1-3 entries;
- preserve all exact source-backed dimensions and limits.

Constraints:
- Do not invent facts or numbers.
- Do not make wording longer merely to mention both sources.
- Do not repeat the same concern or action with synonyms.
- Each output entry may reference at most one historical index.
- If an output entry has a historical index and no standard index, copy that historical concern and recommendation verbatim.
- Modify historical wording only when one or more cited standards add a precise requirement to the same physical mechanism.
- Concerns are concise physical-risk statements.
- Recommendations are concise imperative actions and do not begin with "Ensure."
- historical_indices and standard_indices identify exactly which inputs support each result.
- Every historical index must appear in at least one output entry.
- A standard index may be omitted when it is redundant, non-actionable, or less reliable than the historical control.

Stop after the smallest complete set is represented in the required JSON schema.
```

The strict response is:

```json
{
  "entries": [
    {
      "concern": "...",
      "recommendation": "...",
      "historical_indices": [0],
      "standard_indices": [0]
    }
  ]
}
```

The schema permits 1–12 entries. Local validation additionally ensures:

- the dynamic maximum is respected;
- each result references at most one historical anchor;
- every referenced input index exists;
- every historical index appears exactly once across the result;
- every result has at least one source;
- historical-only wording is reset in code to an exact copy;
- no unsupported numbers were introduced;
- likely duplicates are rejected.

If every model/validation attempt fails, the script falls back locally: preserve all historical entries and append as many non-identical standard controls as the dynamic output limit permits. This fallback allows the pipeline to continue, but it should be reviewed because it is less semantically sophisticated than a successful merge.

### 4.10 Stage 4: batched embeddings

Rows without an embedding are embedded in batches of at most 100 strings:

```ts
openai.embeddings.create({
  model: CHECKLIST_STANDARD_EMBEDDING_MODEL ?? "text-embedding-3-small",
  input: batch.map(row =>
    `${row.tool_description_normalized} ${row.failure_mode}: ${row.concern} ${row.recommendation}`
  ),
});
```

Unlike the historical generator, this text includes both concern and recommendation, and up to 100 rows share one HTTP/API request.

Unaffected historical rows reuse the embeddings already stored in `fmea_checklist`. Rows produced by an affected merge group start with `embedding = null`, including preserved historical anchors inside that group, and are embedded again.

### 4.11 Stage 5: validation and atomic table replacement

Before a write, local validation checks:

- unique `(tool, failure mode, sub_concern_index)` keys;
- non-empty concern and recommendation;
- at least one source type;
- standards-backed rows have standard references;
- every original historical checklist UUID appears in the final rows.

Unless `--dry-run` is set, the script:

1. Ensures the target schema exists.
2. Starts a PostgreSQL transaction.
3. Truncates `fmea_checklist_standard`.
4. Inserts every final row.
5. Commits only after every insert succeeds.
6. Rolls back on failure.

The original `fmea_checklist` table is never truncated or changed by this generator.

## 5. Exactly how much data is sent per standards submission

There is no single fixed number. It depends on the source or affected group. These are the hard rules:

| Request type | Unit per submission | Hard input cap in code | Hard output cap |
|---|---|---|---|
| Standard extraction | One complete filtered standard source | No token/character cap; candidate tools capped at 40 | 6 controls; 5,000 output tokens |
| Group merge | One tool × failure-mode group | Evidence excerpt capped at 800 characters per cited reference; no total input cap | Dynamic maximum, never above 12; 5,000 output tokens |
| Standard embedding | Up to 100 final-row strings | 100 strings per request | One embedding per string |

Measured inputs for the verified 28 July 2026 generation, reconstructed from the current database, source JSON, and cache:

| Measurement per request | Minimum | Median | Average | Maximum |
|---|---:|---:|---:|---:|
| Extraction evidence items | 1 | 4 | 4.2 | 14 |
| Extraction candidate tools | 0 | 3 | 5.8 | 29 |
| Extraction dynamic input characters | 980 | 1,667 | 1,757.1 | 4,569 |
| Extracted controls returned | 0 | 1 | 1.5 | 6 |
| Merge historical inputs | 0 | 0 | 0.6 | 7 |
| Merge standard inputs | 1 | 1 | 1.6 | 7 |
| Merge dynamic input characters | 360 | 748 | 1,095.4 | 5,180 |
| Merge calculated output maximum | 1 | 1 | 2.0 | 10 |

These dynamic input character counts exclude the fixed instructions, JSON schema, API framing, and any validation feedback added on retries. They are not token counts.

Current full-run counts:

| Item | Count |
|---|---:|
| Filtered standard sources | 88: 74 Product Standards + 14 Baseline Standards |
| Filtered evidence items | 366: 290 Product + 76 Baseline |
| Extracted controls | 131 |
| Affected merge groups | 299 |
| Final combined rows | 1,726 |
| Rows regenerated/embedded from affected groups | 573 |
| Historical rows copied with existing embedding | 1,153 |

Assuming valid first responses and empty caches, that run shape means:

```text
Extraction Responses requests = 88
Merge Responses requests      = 299
Embedding requests            = ceil(573 / 100) = 6
Total API requests            = 393
```

With the default four total attempts, the 387 logical generation jobs could make as many as 1,548 Responses API attempts if every job used all attempts, plus embedding requests. This is a theoretical failure/repair ceiling for that run shape, not the normal count.

Concurrency does not change how much data is in a request. With the default `CHECKLIST_STANDARD_CONCURRENCY=3`, it allows up to three source extraction jobs or three merge jobs to be in progress concurrently.

## 6. Cache behavior, reruns, and cost implications

Extraction cache path:

```text
migration/checklist_standard_work/<model>/extractions/
```

The extraction cache key hashes:

- the complete loaded source and evidence;
- candidate tool list;
- allowed failure-mode list;
- prompt version.

Merge cache path:

```text
migration/checklist_standard_work/<model>/merges/
```

The merge cache key hashes:

- tool and failure mode;
- complete historical inputs;
- complete standard controls and provenance;
- prompt version.

Consequences:

- An unchanged rerun normally makes no extraction or merge generation calls because it reads cached JSON.
- Changing source data, candidate tools, failure modes, historical checklist content, model-specific work directory, or prompt version can invalidate relevant cache entries.
- `--force` bypasses both caches.
- Caches store successful parsed outputs, not API credentials.
- Caches are local generated artifacts and ignored by Git.
- Embeddings are not cached separately for affected merged rows. Even when extraction and merge results are fully cached, the current implementation still embeds those rows again. For the measured run shape, an unchanged full rerun therefore makes 6 embedding requests for 573 texts.
- `--dry-run` still performs those calls and writes cache/report files; it only skips the database write.

The code does not persist OpenAI `usage` fields, request IDs, input/output token counts, latency, or calculated cost. Exact billing cannot be derived from the database or report. To make cost auditable, capture the SDK response usage for every request and aggregate it by model, stage, generation run ID, and cache status.

## 7. What is and is not submitted to OpenAI

| Data | Historical consolidation | Standards extraction | Standards merge | Embedding |
|---|---:|---:|---:|---:|
| Normalized tool name | Yes | Candidate list | Yes | Yes |
| Tool category | Yes when present | Model outputs it | Present inside standard control context | Not in combined embedding text |
| Failure mode | Yes | Full allowed list | Yes | Yes |
| Historical learning/recommendation | Yes | No | Historical checklist concern/recommendation only | Final concern/recommendation |
| Product Standard extracted text/tables | No | Yes | Only cited excerpts from extracted controls | No |
| Baseline approved checkpoint text | No | Yes | Only cited excerpts from extracted controls | No |
| Source filenames/workbook sheet names | No | Yes | Source title/type; cited provenance content | No |
| Raw PDF/PPT/XLSX bytes | No | No | No | No |
| Images | No | No | No | No |
| Database record UUID/failure ID | No | No | No | No |
| Database credentials | No | No | No | No |
| API key inside prompt | No | No | No | No |

A source filename can itself contain sensitive project information, and free-text evidence can contain names or identifiers. “No raw document” does not mean “no confidential data.” Review the actual JSON and database text before submission.

## 8. Upstream OpenAI synthesis of historical records

`generate_checklist.ts` assumes useful `learning` and `final_recommendation` fields already exist. One way this repository creates them is:

```powershell
npm --prefix migration run synthesize:openai
```

This is a separate Chat Completions pipeline. Its unit of submission is one raw FMEA record, not one group.

Default request controls:

```dotenv
OPENAI_MODEL=gpt-4o-mini
CONCURRENCY=3
MAX_IMAGES=5
IMAGE_DETAIL=auto
MAX_OUTPUT_TOKENS=600
RETRY_ATTEMPTS=3
REPAIR_ATTEMPTS=1
```

One request sends a text prompt assembled from the record's metadata and recorded evidence, including initial recommendations, first-shot findings/actions, and next-shot findings/actions. It can also attach up to `MAX_IMAGES` supported base64 inspection images from `evidence_images_base64` as `image_url` content parts.

The system instruction makes inspection images the highest-priority evidence, forbids invented physical causes/settings/results, separates the reusable concern from the final physical action, targets a 30–60 word learning, and requires one imperative recommendation. Strict structured output contains exactly:

```json
{
  "learning": "...",
  "final_recommendation": "..."
}
```

Request shape:

```ts
openai.chat.completions.create({
  model: OPENAI_MODEL ?? "gpt-4o-mini",
  temperature: 0.2,
  max_tokens: MAX_OUTPUT_TOKENS, // default 600
  response_format: strictFmeaJsonSchema,
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: [textPrompt, ...imageParts] },
  ],
});
```

If local validation fails, one repair request is allowed by default and resends the record prompt and images with validation errors. Successful output updates only the matched row's `learning` and `final_recommendation`.

This distinction matters for privacy and cost: the two checklist generators do not send images, but the optional upstream synthesis pipeline can.

## 9. Verification and current result

Historical verification:

```powershell
npm --prefix migration run checklist:verify
```

This prints ten recent entries and aggregate record-support statistics. It is primarily an inspection report; it does not fail on incomplete source-index coverage or semantic problems.

Combined verification:

```powershell
npm --prefix migration run checklist-standard:verify
```

It checks:

- empty entries;
- missing historical rows;
- duplicate unique keys;
- exact duplicate concern/recommendation pairs within a group;
- standards-backed entries with missing provenance.

Verified live snapshot on 3 August 2026:

| Measurement | Value |
|---|---:|
| Combined entries | 1,726 |
| Unique groups | 883 |
| Unique tools | 251, including the `*` global-process key |
| Entries carrying historical evidence | 1,330 |
| Entries carrying Product Standard evidence | 306 |
| Entries carrying Baseline Standard evidence | 131 |
| Global-process entries | 3 |
| Entries with standard references | 428 |
| Empty entries | 0 |
| Missing historical rows | 0 |
| Duplicate unique keys | 0 |
| Duplicate concern/recommendation pairs | 0 |
| Invalid standards provenance | 0 |

Source-type counts overlap: one row can contain both historical and standard evidence, so those columns must not be added to calculate the total.

## 10. Known limitations and engineering risks

Historical generator limitations:

- It uses manual JSON parsing instead of strict structured output.
- It does not validate index range or require every input learning to be cited.
- It has no model/API retry loop; the database insert retry does not retry the OpenAI request.
- It sends all records in a group with no input-size guard.
- Eligibility groups include `tool_category`, but the existing-row filter and target unique key use only tool plus failure mode. Different categories sharing the same tool/failure pair can therefore be skipped or collide, and a null-category record query can pull all categories for that tool/failure pair.
- Embeddings are made one at a time, increasing request count.
- With forced reprocessing, upserts do not delete a stale higher `sub_concern_index` if the new model returns fewer entries for the group.
- Errors are logged per group and the overall run continues, so “generation complete” does not prove every eligible group succeeded.

Combined generator limitations:

- Candidate tool routing is based on title/slug token heuristics. A relevant tool can be missed if naming differs significantly.
- Extraction sees only text already represented in the JSON. It cannot recover a control visible only in a source image or unextracted drawing.
- Numerical validation proves that a number appeared in cited evidence, not that the model applied it to the correct dimension.
- Duplicate validation uses word-overlap thresholds, not a semantic model or expert judgment.
- The local fallback merge can preserve continuity after repeated failure but should receive engineering review.
- `--dry-run` is database-safe, not cost-free.
- The final-table write is atomic, but it truncates/replaces the table inside the transaction; database backup and verification remain required.
- Token usage and cost are not logged.
- Generated entries are marked unverified unless inherited as an untouched verified historical row. AI output still requires subject-matter-expert review before engineering approval.

## 11. Recommended safe operating procedure

1. Confirm `migration/.env` points to the intended database and API project without printing secrets.
2. Back up `fmea_checklist_standard` before a full non-dry run.
3. Review changes to the three local standards JSON/mapping inputs.
4. Run one source with `--extract-only --source <slug>` and inspect `latest-report.json` plus the extraction cache.
5. Run `--dry-run --limit 5`; remember that it can still incur API charges.
6. Inspect concerns, recommendations, exact dimensions, applicability, and provenance.
7. Run the full generator without `--force` so unchanged work uses cache.
8. Run `checklist-standard:verify` immediately.
9. Compare counts with the previous report and inspect standards-backed samples.
10. Have an FMEA/tooling subject-matter expert approve generated engineering content.
11. Record model, prompt version, run ID, date, source revision, and reviewer outside the ignored cache directory.

## 12. Quick reference: which model setting controls what

| Setting | Used by | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | All three offline AI pipelines | Required | API authentication |
| `OPENAI_MODEL` | Historical synthesis and historical consolidation | `gpt-4o-mini` | Chat generation |
| `CHECKLIST_STANDARD_MODEL` | Standards extraction and merge | `gpt-5.6-terra` | Structured generation |
| `CHECKLIST_STANDARD_REASONING_EFFORT` | Standards extraction and merge | `low` | Responses API reasoning effort |
| `CHECKLIST_STANDARD_EMBEDDING_MODEL` | Combined embeddings | `text-embedding-3-small` | Final-row embedding |
| `CHECKLIST_STANDARD_CONCURRENCY` | Standards extraction and merge | `3` | Simultaneous logical jobs |
| `CHECKLIST_STANDARD_RETRY_ATTEMPTS` | Standards extraction and merge | `4` | Total attempts per logical job |
| `MAX_IMAGES` | Upstream record synthesis only | `5` | Maximum evidence images per record request |

## 13. Primary implementation files

| File | Responsibility |
|---|---|
| `migration/synthesize_all_openai.ts` | Optional one-record learning/recommendation synthesis, including images |
| `migration/generate_checklist.ts` | Historical grouping, consolidation, embedding, and `fmea_checklist` writes |
| `migration/generate_checklist_standard.ts` | Standards loading, extraction, merge, validation, embedding, caching, and combined-table writes |
| `migration/create_checklist_table.sql` | Historical table schema |
| `migration/create_checklist_standard_table.sql` | Combined table schema |
| `migration/verify_checklist.ts` | Historical output inspection |
| `migration/verify_checklist_standard.ts` | Combined output integrity verification |
| `server/checklistService.ts` | Runtime database matching; no OpenAI call |
| `server/index.ts` | Draft FMEA API flow and checklist attachment |

When this document and the implementation disagree, treat the TypeScript and current database as authoritative, investigate the difference, and update this document with the code change.
