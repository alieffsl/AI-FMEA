# Remediation — Section 4 (Bugs and technical issues)

**Date:** 2026-08-05
**Scope:** the defects catalogued in §4 of [CODEBASE_REVIEW.md](CODEBASE_REVIEW.md), plus draft persistence (§4.5) and two §5/§6 items that were one-line fixes in code already being touched.

## Migrations — applied 2026-08-05

Both migrations have been **run against `SmartHost` (PostgreSQL 18.3, ap-southeast-3)**.

| Step | Result |
|---|---|
| `migration/03_create_draft_tables.sql` (via `run_03_draft_tables.cjs`) | `fmea_draft` + `fmea_draft_row` created |
| `npm --prefix migration run normalize:populate` | 5,361 records processed, **2 rows corrected** |
| Post-run drift check | **0 rows** differ between stored column and canonical normalizer |

> **Rotate the database password.** It was pasted into a chat transcript during this work.

### What the dry run caught

Re-populating blind would have **corrupted a row**. Comparing the canonical normalizer against the stored column *before* writing showed:

```
"V6986-2879-Kelly-big-bow-shoes"
  stored:   "Kelly Big Bow Shoes"             ← correct
  proposed: "V6986 2879 Kelly Big Bow Shoes"  ← regression
```

The stored column had been built by a *better* normalizer than the one left in `migration/`. Pattern A required exactly three letters (`[A-Z]{3}`), so a `V6986-` prefix was never stripped. Pattern A was widened to `[A-Z]{1,5}\d{2,5}-\d{3,4}-` — the two-group shape is unambiguous, so accepting 1–5 letters is safe. Pattern A2 (single group) was deliberately left narrow, because widening it would also strip legitimate part codes such as `FP21009-TORSO FT`.

After that fix the dry run flipped to 2 rows that were *stale in the database* (`"Y7557 2869 Chelsea's Shoes"` → `"Chelsea's Shoes"`), which the populate run then corrected.

`populate_normalized_tool_descriptions.ts` also could not run at all: it imported `./normalizeToolDescription.js`, which does not resolve under this project's `ts-node --esm` setup. Fixed to `.ts`, matching `test_normalize.ts`.

### COMPOUND_WORDS corrected — and it fixed a live matching break

`COMPOUND_WORDS` was decomposing ordinary single words: `headband` → `Head Band`, `necklace` → `Neck Lace`, `backpack` → `Back Pack`, and `anklet` → the nonsensical `Ankle T`. It now maps each term to its **canonical display name**; only `hairclip` → `Hair Clip` still splits, because that one is genuinely two words.

This was not cosmetic. The map defines the join key, and the two tables had been disagreeing in production:

| Term | `fmea_knowledge_base` (before) | `fmea_checklist_standard` |
|---|---|---|
| Necklace | `Neck Lace` ×100 | `Necklace` ×47 |
| Headband | `Head Band` ×41 | `Headband` ×30 |
| Sunglasses | `Sun Glasses` ×31 | `Sunglasses` ×17 |
| Handbag | `Hand Bag` ×14 | `Handbag` ×5 |
| Earring | `Ear Ring` ×5 | `Earring` ×8 |

The checklist table was generated with the canonical spellings while the knowledge base used the split ones, so **checklist matching for these terms silently returned nothing**. Repopulating corrected 198 knowledge-base rows and the two tables now agree; drift is back to 0/5,361.

## Verification

| Check | Before | After |
|---|---|---|
| `npx vitest run` | 17 passed | **27 passed** |
| `npx tsc -b` (frontend) | exit 0 | exit 0 |
| `npx tsc --noEmit` (server) | exit 0 | exit 0 |
| `npx vite build` | 1,585,119 B | **1,552,050 B** (−33 KB) |

The bundle shrank because removing the mock-data fallback let the 1,356-line demo dataset be tree-shaken out of production.

### Runtime verification against the live database

The API was started and every new and rewritten endpoint exercised end to end:

- `POST /api/fmea/draft` → saved, returned id and row count
- `GET /api/fmea/draft/:id` → restored with `checklistEntries` JSONB and `created_by` intact
- `PATCH /api/fmea/draft/:id/row/0` → updated, parent `updated_at` bumped
- `GET /api/fmea/drafts` → correct `rowCount` aggregation
- `POST /api/fmea/generate` → 20 rows across 3 tools; the rewritten `VALUES` CTE and `= ANY()` batch queries ran clean
- Error paths: invalid uuid → 400, missing draft → 404, empty drafts → 400, `?limit=9999999` clamped to 200, `?page=0` no longer 500s

The generate run confirmed the §4.1 fix in production data: `"V6986-2879-Kelly-big-bow-shoes"` normalized to `"Kelly Big Bow Shoes"` **and matched historical evidence**. It would have found nothing before. All row ids were unique UUIDs, all five placeholder fields were blank, and the unmatched tool was correctly flagged `hasEvidence: false`.

The verification draft was deleted afterwards (`fmea_draft` and `fmea_draft_row` are both back to 0 rows, which also confirmed the `ON DELETE CASCADE`).

---

## What was fixed

### §4.1 — Divergent normalizers *(Critical)*

The three copies are now **byte-identical**, sourced from `migration/`'s version — the one that populated `fmea_knowledge_base.tool_description_normalized`, so no data rewrite is forced by the code change itself.

A physically shared module was considered and rejected: `src/` is ESM+bundler, `server/` is CommonJS with `rootDir: "./"`, and `migration/` is ESM requiring `.js` specifiers. Sharing would mean changing the server's `rootDir`, which moves the deployed entry point from `dist/index.js` to `dist/server/index.js` and breaks `deploy/ecosystem.config.cjs`. Instead, `src/utils/normalizeToolDescription.test.ts` now **fails the build if any two copies differ**, plus 8 golden-case tests covering every rule that had drifted.

**A second, worse bug surfaced while fixing this.** The normalizer is not idempotent:

```
"FP21009-TORSO FT"  →  "Fp21009 Torso FT"  →  "Torso FT"
```

The client normalized before sending, and the server normalized *again*, so the value no longer matched the database column (normalized once from raw). **Unifying the copies alone would not have fixed matching.** The client now sends the **raw** description and the server normalizes exactly once. An idempotency regression test guards this.

`src/services/fmeaGenerator.ts` also now sends a lean DTO instead of the whole `ToolRow[]`, dropping `rawRowData` (every parsed cell) and `images` (which serialised to `{}`) from every request.

### §4.2 — Silent mock-data fallback *(Critical)*

Deleted. `generateFmea` now throws on network failure, non-2xx, and malformed responses; `App` surfaces it through the existing error state. `generateLocalFmea` and its imports are gone, so the demo dataset can no longer reach a real draft. `src/lib/fmeaEngine.ts` and `src/data/fmeaMockData.ts` remain in the repo, still covered by their own tests, but are no longer wired into production.

### §4.3 — Colliding row IDs *(High)*

`Math.random().toString(36).substring(7)` → `crypto.randomUUID()`.

### §4.5 — No persistence *(High)* — **needs the migration above**

- `migration/03_create_draft_tables.sql`: `fmea_draft` + `fmea_draft_row`, full `FmeaDraftRow` kept as JSONB with tool/failure/S/O/D/RPN promoted to columns for querying.
- Four endpoints: `POST /api/fmea/draft`, `GET /api/fmea/drafts`, `GET /api/fmea/draft/:id`, `PATCH /api/fmea/draft/:id/row/:rowIndex` (the PATCH is groundwork for editable rows, §7.2).
- `src/services/draftStore.ts` + autosave after generation. The draft id goes into the URL as `?draft=<id>`, and the app restores from it on load.
- Insert is transactional and **chunked at 5,454 rows per statement** — Postgres caps a statement at 65,535 bind parameters, and at 11 per row a large CDI would otherwise fail the whole save.
- `created_by` records an `X-FMEA-User` header if a proxy sets one. **This is not a security boundary** — it is a placeholder until §5.1 (SSO) lands.

### §4.6 — Images collected and discarded *(High)*

Relabelled per your decision: the column is now **"Attachments"**, with tooltips stating they are session-only, not uploaded, and not used for matching. The blob-URL leak is fixed — reset now revokes every thumbnail (previously only per-image removal did).

### §4.8 — Connection churn and N+1 queries *(High)*

- All six ad-hoc `new Client(...)` sites now use pooled connections (`server/index.ts` and `server/checklistService.ts`, which grew its own pool).
- The knowledge-base fallback loop → **one** query using a `VALUES` join with `ROW_NUMBER()` for the per-pair limit.
- The S/O/D loop → **one** `GROUP BY` query over `= ANY($1::text[])`, and the O(n×m) inner rescan of `draftRows` is gone.

A 20-tool CDI went from roughly 4 connection handshakes plus 150+ round-trips to a pooled handful.

### §4.9 / §4.11 — Upload and parser *(Medium)*

- Drag-and-drop validation no longer silently swallows errors; validation lives solely in `App`, which owns the error state. The dead dismiss button (`onClick={() => {}}`) is wired up.
- The parser falls back to scanning **all** sheets when none is named `TOOL PLAN`, warns when it does, and the failure message now names the sheets it checked.

### §4.12 / §4.13 — Query correctness *(Medium)*

- The `learning IS NOT NULL AND final_recommendation IS NOT NULL` predicate now applies in **both** branches, so applying a filter can no longer make the reported total go *up*. Both branches collapsed into one code path.
- `page`, `limit`, and `threshold` are clamped (`?limit=10000000` and `?page=0` no longer work; a `NaN` threshold no longer silently makes every fuzzy match fail). `POST /api/fmea/generate` and `/api/checklist/match-batch` reject more than 500 tools with a 413.

### §4.14 / §4.15 — Row identity and filler text *(Medium)*

- The server echoes the client's `toolRowId`; `App` matches on it instead of guessing by description.
- New `hasEvidence` and `sodSource` flags. Rows with no historical match now get a distinct amber **"No evidence"** status instead of being reported as drafted.
- Per your decision, `potentialEffect`, `processStep`, `currentPreventionControl`, `currentDetectionControl`, and `responsibleFunction` are now **blank** rather than shipping constants like `"Injection Molding"` and `"Design review"` that read as analysis in the exported workbook.

### §4.7 — Unbounded dashboard query *(High — fixed)*

`/api/dashboard/stats` no longer selects every row of the knowledge base. All six figures are now computed with `GROUP BY` in SQL, and the drill-down drawer fetches its rows on demand from a new paginated `GET /api/dashboard/cases`.

**Measured against the live database: the payload went from 4,980,382 bytes to 3,159 — a 1,577× reduction**, and it no longer grows with the knowledge base.

Grouping is on `tool_description_normalized` as stored, per the product decision that a position suffix identifies a different tool. The dashboard now reports `Torso FT` (98), `Earring LT` (59) and `Shoes RT` (50) as distinct part groups, and uses the same key as the matcher.

Also fixed in the same pass:

- Fetched on every app start → fetched only when the dashboard is opened, once.
- No loading or error state (§6.3) → loading, empty, and error states, the last with a working **Retry**.
- The dead `projects` query and prop were removed; they were fetched, passed, and never read.
- **`cleanToolDescription` deleted.** This fourth normalizer truncated descriptions to their first word (`"Torso FT"` → `"Torso"`, `"Hair Clip"` → `"Hair"`), merging tools the rest of the system keeps distinct. Nothing uses it now.
- The material/gate bars scale against the largest value instead of a fixed `count * 18` multiplier that saturated at 6.

Verified live: every drill-down total matches its aggregate count exactly (failure 1,077; family `Torso FT` 98; risk `Critical` 2,002; status `Close FS` 2,005; material/gate `ABS / SUB GATE` 960), which cross-checks the `/cases` predicates against the `/stats` `GROUP BY` expressions. Bad dimension → 400, missing value → 400, `page=0` and `limit=99999` clamp to 1 and 200.

### §4.16 and adjacent one-liners

Protocol-relative image URLs (server and client) so evidence images survive the move to TLS; `let allRows` → `const`; accessible names on the selection checkboxes (§6.6); and the **privacy notice corrected** (§5.8) — it claimed "No data is uploaded to any server" while generation POSTs every parsed tool row.

---

## Deliberately not changed

- **§4.4 RPN bands** — kept at Critical ≥36 / High ≥27 / Medium ≥9 at your direction. Worth recording that with the server's own `6×4×4 = 96` defaults, effectively every row still classifies as Critical, so the Risk Distribution chart and the High-RPN filter remain non-discriminating. Revisit if that becomes a problem.
- **§4.16 `nextShotActions`** — still hard-coded `[]`; needs a product decision on where that data comes from.
- **§4.16 `AVG()` of S/O/D across unrelated tools** — still averages "flash" on a torso with "flash" on an earring. Flagged as open question 5.
- **Sections 5, 6, 7** — untouched apart from the two one-liners noted above. The highest-priority remaining items are TLS (§5.3), authentication (§5.1), and DB certificate verification (§5.2).

## Migration 04 — applied

`migration/04_fix_stranded_checklist_names.sql` has been run (`run_04_fix_stranded_checklist.cjs`): 6 checklist entries stranded by the Pattern A widening were renamed from `"Y7557 2869 Chelsea's Shoes"` to `"Chelsea's Shoes"`, reconnecting them to the 2 matching knowledge-base rows.

### End-to-end result of the normalizer corrections

Re-running `POST /api/fmea/generate` against the live database confirms every corrected term now reaches evidence it previously could not:

| Input | Normalized | Failure modes | Checklist entries |
|---|---|---|---|
| `Y7557-2869-Chelsea's shoes` | `Chelsea's Shoes` | 3 | **7** (was 0) |
| `necklace` | `Necklace` | 18 | **41** (was 0 as `Neck Lace`) |
| `headband` | `Headband` | 15 | **35** (was 0 as `Head Band`) |
| `sunglasses` | `Sunglasses` | 12 | **22** (was 0 as `Sun Glasses`) |
| `anklet` | `Anklet` | 1 | 0 — correctly reported `hasEvidence: false` |

**105 checklist recommendations** that the tool was silently failing to surface are now returned.

Two further checklist anomalies are **deliberately left alone** because each needs a human decision:

1. **Six entries have an empty `tool_description_normalized`.** They carry real concerns — one references "the edge of the bracelet" — but lost their tool name during generation. Mapping them to `Unknown` would attach them to every tool with a missing description, which is worse than leaving them unreachable. They need triage against their `supporting_record_ids`.
2. **Six entries named `Hairclip` should be `Hair Clip`,** but five of the six collide with existing `Hair Clip` rows on `(tool_description_normalized, failure_mode, sub_concern_index)`. Resolving it means either discarding them as duplicates or renumbering `sub_concern_index`, depending on whether the colliding concerns say the same thing.

## Hang on "Restoring saved draft" / "Loading dashboard"

Two causes, found after the loading states were reported stuck.

**1. The API server was not running.** In development Vite proxies `/api` to port 3001, and when nothing is listening there the proxied request never settles — so every caller sat on a spinner indefinitely. **Both processes are required:**

```bash
npm run dev          # Vite, port 5173
npm run dev:server   # API,  port 3001
```

**2. A dependency loop in the dashboard effect** would have hung it even with a healthy API. The effect listed `dashboardState` in its dependencies *and* called `setDashboardState("loading")`. That re-triggered the effect, whose cleanup set `cancelled = true`, so the in-flight request's handlers were all discarded and the state never left `loading`. The "already requested" guard is now a `useRef`, and the retry path calls the loader directly.

**Hardening so this fails loudly instead of hanging.** A new `src/lib/http.ts` wraps every API call with a 20s timeout (45s for draft saves) and a specific message naming `npm run dev:server`. Applied to the dashboard stats, drill-down rows, case-history details, and all draft calls. Two silent-failure paths were fixed alongside it:

- A failed draft restore set `generateError`, which the upload screen never renders — so it looked like a normal empty start. It now has its own dismissible banner.
- The case-history fetch only did `console.error`, leaving the expanded panel blank forever. It now shows the error inline.

## Resolved: dashboard part-group semantics

**Decision: keep position-suffixed tools separate.** `Torso FT` and `Torso RR` are distinct part groups on the dashboard, not a merged `Torso`. This matches the rule already enforced in matching (`calculateTextSimilarity` returns `0.0` for suffix-only differences) and in normalization (`PRESERVE_UPPERCASE`). Aggregation therefore groups on `tool_description_normalized` as stored, and `cleanToolDescription` has been deleted.
