# Codebase Review — AI FMEA Tooling Copilot

**Review date:** 2026-08-05
**Commit reviewed:** `4347031` (branch `main`)
**Scope:** full repository inspection — no files were modified. Only read-only verification commands were run (`vitest run`, `tsc -b`, `tsc --noEmit` in `server/`).

**Verification results at time of review:**

| Command | Result |
|---|---|
| `npx vitest run` | 3 files, 17 tests — **all pass** |
| `npx tsc -b` (frontend) | **clean**, exit 0 |
| `npx tsc --noEmit` (server) | **clean**, exit 0 |

Everything labelled **Confirmed** below was read directly in the source. Everything labelled **Assumption** could not be verified without live database access or a running deployment and is flagged as such.

> **Remediation status (2026-08-05).** Section 4 has since been worked through — see `REMEDIATION.md` for what changed, what still needs a database migration applied, and what was deliberately left alone. §4.4 (RPN bands) was reviewed and **kept as-is** at the product owner's direction. Sections 5, 6, and 7 are untouched and still open.

---

## 1. Application overview

AI FMEA Tooling Copilot generates a first-draft FMEA (Failure Mode and Effects Analysis) for injection-mould tooling. A tooling engineer uploads a CDI / Tool Plan Excel workbook; the app parses the tool rows, matches each normalized tool name against a PostgreSQL knowledge base of historical FMEA records plus an AI-generated combined checklist (historical + MEC Product Standards + Baseline Tooling Standards), and renders a draft with S/O/D scores, RPN, concerns, and recommendations.

### Tech stack

| Layer | Technology | Evidence |
|---|---|---|
| Frontend | React 19, TypeScript 5.8 (strict), Vite 7, Tailwind 3.4, Recharts 2.15, lucide-react | [package.json](package.json) |
| Backend | Express 5, Node, `pg` 8, `ts-node` in dev / compiled `dist` in prod | [server/package.json](server/package.json) |
| Database | PostgreSQL (primary). Microsoft SQL Server is a legacy one-off migration source only | [server/db.ts](server/db.ts), [server/migrate_to_postgres.ts](server/migrate_to_postgres.ts) |
| Parsing | `xlsx` (SheetJS) in the browser | [src/services/cdiParser.ts](src/services/cdiParser.ts) |
| Offline AI | OpenAI SDK, used only by `migration/` scripts — never at request time | [migration/generate_checklist_standard.ts](migration/generate_checklist_standard.ts) |
| Tests | Vitest (3 files) | [src/lib/fmeaEngine.test.ts](src/lib/fmeaEngine.test.ts) |
| Deploy | EC2 + PM2 (`fmea-api`) + nginx static + reverse proxy, HTTP basic auth | [deploy/](deploy/) |

### Folder structure

```
src/            React SPA (no router library — hand-rolled pushState routing)
  components/   layout, dashboard, knowledge, standards, ui
  data/         bundled JSON/TS datasets + mock data (~12k lines)
  lib/          fmeaEngine (legacy local engine), normalization, validation
  services/     cdiParser, fmeaGenerator (API client), exportService
  utils/        excelExport, checklistSources, normalizeToolDescription
server/         Express API (index.ts 1120 lines, checklistService.ts 474)
migration/      one-off DB build scripts, SQL DDL, OpenAI checklist generators
scripts/        .cjs asset/database generators
public/         1.4 GB of MEC engineering source files (PDF/PPT/DWG/PRT/XLSM)
deploy/         nginx conf, PM2 ecosystem, update.sh
```

### Database tables (from DDL and queries)

`fmea_knowledge_base` (historical records + `tool_description_normalized`, S/O/D, `evidence_images`, `evidence_images_base64`), `fmea_checklist_standard` (combined AI checklist, [migration/create_checklist_standard_table.sql](migration/create_checklist_standard_table.sql)), `fmea_checklist` (legacy, preserved), `fmea_projects`, `fmea_tools`, `fmea_case_timeline` ([migration/02_normalize_schema.sql](migration/02_normalize_schema.sql)).

### Authentication, authorization, roles

**There are none in the application.** The only access control is nginx HTTP basic auth ([deploy/nginx-fmea.conf](deploy/nginx-fmea.conf) — the config itself comments *"The application has no built-in login yet"*). There is no user model, no session, no roles, no per-user attribution. This is the single largest architectural gap and it blocks the review/approval workflow the product description implies.

### API surface (11 endpoints, all in [server/index.ts](server/index.ts))

`POST /api/fmea/generate`, `GET /api/dashboard/stats`, `GET /api/dashboard/case/:id/details`, `GET /api/knowledge/search`, `GET /api/knowledge/filters`, `GET /api/knowledge/:id/images`, `GET /api/knowledge/historical-for-failure`, `GET /api/checklist/match`, `POST /api/checklist/match-batch`, `GET /api/checklist/stats`, `GET /api/checklist/failure-modes`.

**Every endpoint is read-only.** There is no endpoint that writes anything. The application cannot persist a draft, an edit, an approval, or a review comment.

---

## 2. Current feature inventory

### Working and reachable

| Feature | Location | Notes |
|---|---|---|
| CDI `.xlsx`/`.xlsm` upload + drag-drop | [src/components/CdiUploadPanel.tsx](src/components/CdiUploadPanel.tsx) | client-side parse |
| Header auto-detection (30-row scan, 24 column alias families) | [src/services/cdiParser.ts:102](src/services/cdiParser.ts#L102) | requires sheet named `TOOL PLAN` |
| Project metadata extraction (colon-split, right-scan, below-scan) | [src/services/cdiParser.ts:146](src/services/cdiParser.ts#L146) | |
| Tool row table with select-all / per-row select | [src/components/ToolingTable.tsx](src/components/ToolingTable.tsx) | |
| Per-row image attach + thumbnail | [src/components/ToolImageUploader.tsx](src/components/ToolImageUploader.tsx) | images go nowhere — see §4.6 |
| Draft generation against PostgreSQL | [server/index.ts:125](server/index.ts#L125) | |
| Fuzzy checklist matching (Jaccard + Levenshtein + suffix/length guards) | [server/checklistService.ts:40](server/checklistService.ts#L40) | |
| Grouped draft view with source badges | [src/components/FmeaDraftTable.tsx](src/components/FmeaDraftTable.tsx) | read-only |
| Excel export of draft (14 columns incl. standards refs) | [src/utils/excelExport.ts](src/utils/excelExport.ts) | reachable via table button |
| Dashboard: Pareto, part-group, risk, status, material/gate + drilldown | [src/components/dashboard/OverviewDashboard.tsx](src/components/dashboard/OverviewDashboard.tsx) | |
| Case timeline drilldown | [server/index.ts:572](server/index.ts#L572) | `nextShotActions` always empty |
| Knowledge base search: 5 filters + full-text, 300 ms debounce, abort, paging | [src/components/knowledge/KnowledgeBase.tsx](src/components/knowledge/KnowledgeBase.tsx) | best-built screen |
| MEC standards browser: tree, search, article renderer, source doc viewer | [src/components/standards/](src/components/standards/) | |
| Light/dark toggle with pre-paint FOUC guard | [index.html:12](index.html#L12), [src/components/layout/AppShell.tsx:41](src/components/layout/AppShell.tsx#L41) | dark mode incomplete — see §6.1 |
| Demo data mode | [src/App.tsx:120](src/App.tsx#L120) | |

### Built but unreachable from the UI (Confirmed)

`navItems` in [src/components/layout/AppShell.tsx:23](src/components/layout/AppShell.tsx#L23) contains only `generate`, `dashboard`, `knowledge`. But `getInitialView` in [src/App.tsx:27](src/App.tsx#L27) accepts `review` and `export` as valid views. Consequences:

- The **entire Export screen** (Excel / CSV / JSON / Clipboard, [src/App.tsx:438-485](src/App.tsx#L438-L485)) is only reachable by typing `/export` in the address bar.
- The **Review screen** ([src/App.tsx:420](src/App.tsx#L420)) is likewise only reachable via `/review`.
- All of [src/services/exportService.ts](src/services/exportService.ts) (230 lines: `exportCsv`, `exportJson`, `exportExcel`, `copyFmeaToClipboard`) is dead code in practice.
- `AppView` also declares `"product-standards"`, which no code path can ever set.

### Incomplete / disconnected / duplicated code (Confirmed)

| Item | Evidence |
|---|---|
| Row editing declared but not implemented | `FmeaDraftTable` destructures only `{ rows }` and ignores the `onEditRow` prop ([src/components/FmeaDraftTable.tsx:39-41](src/components/FmeaDraftTable.tsx#L39-L41)); `handleFmeaEditRow` in [src/App.tsx:234](src/App.tsx#L234) is therefore dead. README claims *"Displays an editable Draft FMEA"*. |
| `projects` prop fetched, passed, never used | `OverviewDashboard({ historicalCases })` at [src/components/dashboard/OverviewDashboard.tsx:340](src/components/dashboard/OverviewDashboard.tsx#L340); `liveProjects` state and the `fmea_projects` query exist only to be discarded |
| Three divergent copies of `normalizeToolDescription` | [src/utils/](src/utils/normalizeToolDescription.ts), [server/](server/normalizeToolDescription.ts), [migration/](migration/normalizeToolDescription.ts) — see §4.1, this is a correctness bug not just duplication |
| A fourth, unrelated normalizer | `cleanToolDescription` in [server/index.ts:79](server/index.ts#L79) used only by the dashboard; and `normalizeToolDescription` in [src/lib/normalization.ts:69](src/lib/normalization.ts#L69) returning a different shape for the legacy engine |
| Two competing Excel exporters | [src/utils/excelExport.ts](src/utils/excelExport.ts) (rich, reachable) vs `exportExcel` in [src/services/exportService.ts:138](src/services/exportService.ts#L138) (3-sheet, unreachable) |
| Legacy mock engine wired as silent production fallback | [src/lib/fmeaEngine.ts](src/lib/fmeaEngine.ts) + [src/data/fmeaMockData.ts](src/data/fmeaMockData.ts) (1356 lines) — see §4.2 |
| `nextShotActions` hard-coded empty | [server/index.ts:598](server/index.ts#L598) |
| `server/db.ts` (MSSQL pool) unused by the API | imported by nothing in `server/index.ts` |
| Untracked working files in repo root | `deck_assets/`, `deliverables/`, `scripts/create_management_deck.ps1` are in `git status` but not in `.gitignore` |

---

## 3. Architecture and main data flows

### Flow A — Draft generation (the core path)

```
CdiUploadPanel ──file──> validateCdiFile ──> parseCdiFile (browser, xlsx)
    │                                             │
    │                       normalizeToolDescription  ← src/utils copy
    ▼                                             ▼
ToolRow[] + ProjectMetadata ──> generateFmea() ──POST /api/fmea/generate──┐
                                                                          ▼
  1. normalizeToolDescription (server copy — DIFFERENT RULES, §4.1)
  2. batch SELECT fmea_knowledge_base WHERE LOWER(tool_description_normalized) IN (...)
     + SELECT fmea_checklist_standard WHERE applicability_scope='exact_tool'
  3. one draft row per (tool × distinct failure_mode)
  4. matchChecklistBatch()  → new pg.Client (3rd connection)
  5. per-key fallback SELECT on fmea_knowledge_base → new pg.Client (4th connection)
  6. N serial queries for AVG(S/O/D) — one per unique failure mode
  7. RPN = S × O × D, sort by checklist-entry count
                                                                          ▼
                        { drafts, metadata } ──> FmeaDraftTable (read-only) ──> excelExport
```

Note the **double normalization**: the client normalizes the description into `ToolRow.toolDescription` at [src/services/cdiParser.ts:282](src/services/cdiParser.ts#L282), then the server normalizes that already-normalized string again with a different implementation.

### Flow B — Dashboard

`App` mounts → unconditional `fetch('/api/dashboard/stats')` ([src/App.tsx:79](src/App.tsx#L79)) → server runs an **unbounded** `SELECT` over `fmea_knowledge_base LEFT JOIN fmea_tools LEFT JOIN fmea_projects` with no `LIMIT` and no `WHERE` → every row is mapped in JS and returned as one JSON payload → aggregated client-side with `countBy`.

### Flow C — Knowledge base

Debounced query + filters → `GET /api/knowledge/search` → parameterized SQL with `LIMIT/OFFSET` → paginated table. Images are deliberately deferred to `/api/knowledge/:id/images` — though that endpoint is never actually called by any component (`evidence_images_base64` is always returned as `[]`).

### Flow D — Offline knowledge build (not part of the request path)

`migration/generate_checklist_standard.ts` reads `src/data/mec_product_standard_v2.json` + `accessory_tooling_ai_database.json` + historical checklist, calls OpenAI (`gpt-5.6-terra`, low reasoning), and writes `fmea_checklist_standard`. Correctly separated from runtime — this is a good decision that keeps generation fast, cheap, and repeatable.

### Architectural observations

**Good:** offline AI/online serving split; provenance modelling (`source_types`, `supporting_standard_refs`, `supporting_record_ids`) is genuinely well designed; `applicability_scope` correctly prevents global process rules from polluting every tool; strict TS with `noUnusedLocals`/`noImplicitReturns` enabled and passing.

**Weak:** no persistence layer for user output; no service/repository layer (SQL is inlined in route handlers across 1120 lines); no shared types package between client and server (`FmeaDraftRow` and `ChecklistEntry` are hand-duplicated); no request validation layer; hand-rolled routing that fights with itself (see §4.10).

---

## 4. Bugs and technical issues

### 4.1 — Three divergent `normalizeToolDescription` implementations break exact matching

- **Problem.** The DB column `tool_description_normalized` was populated by `migration/normalizeToolDescription.ts`. The API matches against it using `server/normalizeToolDescription.ts`. These two files are **not** the same. `diff` confirms the server copy is missing: the `COMPOUND_WORDS` map (15 entries), prefix Patterns B and C, and camelCase splitting. The frontend copy in `src/utils/` is a third variant.
- **Evidence.** [migration/populate_normalized_tool_descriptions.ts:6](migration/populate_normalized_tool_descriptions.ts#L6) imports `./normalizeToolDescription.js`; [server/checklistService.ts:6](server/checklistService.ts#L6) and [server/index.ts:7](server/index.ts#L7) import `./normalizeToolDescription`. Confirmed by `diff` of all three files, and by `grep -c COMPOUND_WORDS server/dist/normalizeToolDescription.js` → `0`.
- **Impact.** Any description hitting a diverged rule silently misses the exact-match branch and falls through to fuzzy matching or to `"No historical data"`. Example: `"Hairclip"` → migration produced `"Hair Clip"` in the DB; the server produces `"Hairclip"`; `LOWER(tool_description_normalized) IN (...)` does not match. Same for `"Headband"`, `"Necklace"`, `"Backpack"`, and every space-separated tool-number prefix (Pattern B, e.g. `"Jjb33 001 Torso Ft"`). This directly reduces the evidence recall the product exists to deliver.
- **Recommended solution.** Extract one module (e.g. `shared/normalizeToolDescription.ts`) consumed by `src/`, `server/`, and `migration/`; add a golden-case unit test table; re-run `populate_normalized_tool_descriptions.ts` after unifying; add a CI check that fails if the three files ever diverge again.
- **Priority: Critical** · **Effort: Medium**

### 4.2 — Server failure silently substitutes mock data into a safety-relevant document

- **Problem.** `generateFmea` catches *any* error — including a 500, a DB outage, or a network drop — and falls back to `generateLocalFmea`, which runs against `src/data/fmeaMockData.ts` (invented Barbie/dog-toy demo cases). The UI shows no distinction whatsoever.
- **Evidence.** [src/services/fmeaGenerator.ts:127-135](src/services/fmeaGenerator.ts#L127-L135) — `console.warn` only, then `return { drafts: generateLocalFmea(...) }`.
- **Impact.** An engineer can export an Excel FMEA built entirely from fictional data and never know. For a document that feeds tooling decisions and is described in the README as requiring engineer sign-off, silently fabricated evidence is the most dangerous defect in this codebase.
- **Recommended solution.** Remove the fallback, or gate it behind an explicit `?demo=1` flag. Surface the error via the existing `generateError` state. If a degraded mode is genuinely wanted, tag every fallback row (`provenance: "demo"`) and render a persistent banner plus a watermark in the export.
- **Priority: Critical** · **Effort: Small**

### 4.3 — Draft row IDs can collide or be empty

- **Problem.** `id: Math.random().toString(36).substring(7)` produces a variable-length suffix; for small random values (e.g. `0.5` → `"0.5"`) `substring(7)` returns `""`.
- **Evidence.** [server/index.ts:455](server/index.ts#L455).
- **Impact.** `key={row.id}` collisions in [src/components/FmeaDraftTable.tsx:197](src/components/FmeaDraftTable.tsx#L197) cause React reconciliation errors, and `expandedFailureModes` is keyed on `row.id` — colliding rows expand and collapse together. Empty IDs make several rows share the key `""`.
- **Recommended solution.** Use `crypto.randomUUID()`, or a deterministic `${toolNo}::${failureMode}` key.
- **Priority: High** · **Effort: Small**

### 4.4 — RPN risk buckets are calibrated for the wrong scale

- **Problem.** `getRpnBucket` classifies `Critical ≥ 36`, `High ≥ 27`, `Medium ≥ 9`, `Low < 9`. But RPN is `S × O × D` on 1–10 scales, i.e. range 1–1000. The server's own defaults are `S=6, O=4, D=4` → **RPN 96**, already 2.6× the "Critical" threshold.
- **Evidence.** [src/lib/normalization.ts:130-136](src/lib/normalization.ts#L130-L136); defaults at [server/index.ts:446-450](server/index.ts#L446-L450); the same threshold is reused for the "High RPN" filter and `summary.highRpn` at [src/components/FmeaDraftTable.tsx:48](src/components/FmeaDraftTable.tsx#L48) and [:89](src/components/FmeaDraftTable.tsx#L89).
- **Impact.** The Risk Distribution chart shows essentially everything as Critical; the High-RPN filter filters nothing; risk prioritisation — the entire point of an FMEA — is non-functional.
- **Recommended solution.** Move to conventional bands (Low < 40, Medium 40–99, High 100–199, Critical ≥ 200) or, better, adopt AIAG-VDA Action Priority (S/O/D lookup rather than the RPN product). Confirm the exact bands with the engineering team before changing.
- **Priority: High** · **Effort: Small**

### 4.5 — Draft FMEA cannot be saved; all work is lost on refresh

- **Problem.** There is no write endpoint anywhere in the API and no client-side persistence. `fmeaRows`, `toolRows`, and `metadata` live only in `useState`.
- **Evidence.** All 11 routes in [server/index.ts](server/index.ts) are read-only (verified by `grep "^app\.\(get\|post\|put\|delete\)"`); no `localStorage`/`IndexedDB` writes outside the theme key.
- **Impact.** A browser refresh, an accidental navigation, or a crash destroys a full analysis session. Review, approval, audit trail, and "resume tomorrow" are all impossible. This is the product's biggest functional gap and it is what makes §4.10 and the missing Review screen matter.
- **Recommended solution.** Add `fmea_draft` / `fmea_draft_row` tables and `POST/PATCH /api/fmea/draft`; autosave after generation and after each edit; add a "My drafts" list.
- **Priority: High** · **Effort: Large**

### 4.6 — Uploaded tool images are collected and then discarded

- **Problem.** `ToolImage` holds a `File` object and a `blob:` URL. `generateFmea` sends `JSON.stringify({ tools: toolRows })`, and a `File` serialises to `{}`; the server never reads `images` at all.
- **Evidence.** [src/types/project.ts:16-21](src/types/project.ts#L16-L21), [src/services/fmeaGenerator.ts:104](src/services/fmeaGenerator.ts#L104), no `images` reference in [server/index.ts](server/index.ts).
- **Impact.** The upload UI implies visual evidence influences the draft. It does not — it only affects the "with images" filter count and an export column. Users are misled, and the blob URLs are also leaked (only `removeImage` revokes them; a reset never does).
- **Recommended solution.** Either remove the uploader until the backend supports it, or add multipart upload + object storage + an image reference on the draft row. At minimum, label it "attachments (not used in matching)".
- **Priority: High** · **Effort: Medium** (Small if simply removed/labelled)

### 4.7 — Dashboard loads the entire knowledge base into the browser on every app start

- **Problem.** `/api/dashboard/stats` runs `SELECT ... FROM fmea_knowledge_base LEFT JOIN fmea_tools LEFT JOIN fmea_projects` with no `WHERE`, no `LIMIT`, and no aggregation; all rows are mapped in Node and shipped as JSON. `App` fetches it on mount regardless of which view is active.
- **Evidence.** [server/index.ts:504-535](server/index.ts#L504-L535); [src/App.tsx:79-87](src/App.tsx#L79-L87).
- **Impact.** With the ~1,700+ checklist entries the README cites and an unknown but larger `fmea_knowledge_base`, this is a multi-MB payload on every page load, including for users who only want to upload a CDI file. Latency grows linearly with data forever.
- **Recommended solution.** Push aggregation into SQL (`GROUP BY failure_mode`, `GROUP BY tool_description_normalized`, RPN bucket `CASE`) and return counts; add a paginated `/api/dashboard/cases` for the drilldown; lazy-fetch only when the dashboard view mounts.
- **Priority: High** · **Effort: Medium**

### 4.8 — Four separate PostgreSQL connections per generate request; N+1 S/O/D queries

- **Problem.** `POST /api/fmea/generate` opens a `new Client` at [:138](server/index.ts#L138), another at [:320](server/index.ts#L320), `matchChecklistBatch` opens a third at [server/checklistService.ts:302](server/checklistService.ts#L302), and only the S/O/D step uses the shared pool. The knowledge-base fallback loops one query per no-match key ([server/index.ts:332](server/index.ts#L332)); S/O/D issues one serial query per unique failure mode ([server/index.ts:402](server/index.ts#L402)).
- **Evidence.** As cited. A 20-tool CDI with ~8 failure modes each produces roughly 4 connection handshakes plus 150+ round-trips.
- **Impact.** Slow generation, unnecessary TLS handshakes, and a pool that provides none of the benefit it was added for.
- **Recommended solution.** Use `getPgPool()` everywhere (delete the ad-hoc `Client` instances); collapse the S/O/D loop into one `GROUP BY failure_mode` query with `= ANY($1)`; batch the fallback lookup into a single query over a `VALUES` list.
- **Priority: High** · **Effort: Medium**

### 4.9 — Drag-and-drop validation errors are swallowed

- **Problem.** `handleFile` validates, and on failure `return`s with the comment *"Let parent handle display"* — but the parent is never told.
- **Evidence.** [src/components/CdiUploadPanel.tsx:15-25](src/components/CdiUploadPanel.tsx#L15-L25).
- **Impact.** Dropping a `.pdf` or a 60 MB file does nothing at all — no error, no spinner, no feedback. (Validation is duplicated in `handleFileSelected` at [src/App.tsx:94](src/App.tsx#L94), which is why the browse path works and the drop path does not.)
- **Recommended solution.** Delete the local validation and call `onFileSelected(file)` unconditionally, letting `App` be the single validation owner.
- **Priority: Medium** · **Effort: Small**

### 4.10 — Routing effect pushes history entries on mount and fights the knowledge-base URL writer

- **Problem.** The `useEffect` on `[activeView]` runs on mount and `pushState`s the current view, so the first interaction already has a spurious history entry. Separately, `KnowledgeBase` `replaceState`s `/knowledge?page=N` while `App` will later `pushState` `/${activeView}?page=N`, carrying a stale `page` param onto unrelated views.
- **Evidence.** [src/App.tsx:58-61](src/App.tsx#L58-L61) vs [src/components/knowledge/KnowledgeBase.tsx:230-237](src/components/knowledge/KnowledgeBase.tsx#L230-L237).
- **Impact.** Back button behaves unpredictably; `/dashboard?page=7` is a reachable nonsense URL.
- **Recommended solution.** Adopt a real router (`react-router` or a ~40-line `useSyncExternalStore` hook) with a single URL owner, or skip the first effect run and scope query params per view.
- **Priority: Medium** · **Effort: Medium**

### 4.11 — CDI parser silently requires a sheet named "TOOL PLAN"

- **Problem.** The sheet loop hard-`continue`s unless the sheet name contains `TOOL PLAN`, but the thrown error only talks about columns.
- **Evidence.** [src/services/cdiParser.ts:360-361](src/services/cdiParser.ts#L360-L361); error text at [:398-403](src/services/cdiParser.ts#L398-L403).
- **Impact.** A perfectly valid workbook whose sheet is called `Tooling Plan`, `CDI`, or `Sheet1` fails with a message that sends the user hunting for column problems that don't exist.
- **Recommended solution.** Fall back to scanning all sheets when no `TOOL PLAN` sheet is found; list the discovered sheet names in the error; offer a sheet picker.
- **Priority: Medium** · **Effort: Small**

### 4.12 — Knowledge search totals shift depending on whether a filter is applied

- **Problem.** The no-filter branch adds `WHERE learning IS NOT NULL AND final_recommendation IS NOT NULL`; the filtered branch does not.
- **Evidence.** [server/index.ts:693-757](server/index.ts#L693-L757).
- **Impact.** Selecting a filter can *increase* the reported total, because rows without a learning/recommendation suddenly become visible. Users read this as a bug in the data.
- **Recommended solution.** Apply the same base predicate in both branches.
- **Priority: Medium** · **Effort: Small**

### 4.13 — Unbounded and unvalidated pagination parameters

- **Problem.** `limit` and `page` are parsed from the query string and used directly. `?limit=10000000` executes; `?page=0` yields `OFFSET -50`, which Postgres rejects → 500.
- **Evidence.** [server/index.ts:688-690](server/index.ts#L688-L690); same pattern for `limit` at [:888](server/index.ts#L888) and `threshold`/`limit` at [:962-963](server/index.ts#L962-L963) (a non-numeric `threshold` yields `NaN`, and `NaN` comparisons make every fuzzy match fail silently).
- **Impact.** Trivial resource exhaustion and confusing 500s from any authenticated user.
- **Recommended solution.** Clamp: `Math.min(Math.max(1, n), 200)`; reject `NaN` with a 400 and a clear message. Introduce `zod` for query/body schemas.
- **Priority: Medium** · **Effort: Small**

### 4.14 — `draftStatus` updates use an unreliable match

- **Problem.** After generation, rows are marked `generated` when `d.toolNo === r.toolNo || d.partDescription === r.toolDescription`. `partDescription` has been normalized server-side (possibly by the diverged normalizer of §4.1), so the second clause is unreliable; and rows whose only result is the `"No historical data"` placeholder are still marked `generated`.
- **Evidence.** [src/App.tsx:215-222](src/App.tsx#L215-L222); placeholder creation at [server/index.ts:267-274](server/index.ts#L267-L274).
- **Impact.** The "Without draft" scope filter and the "N drafted" stat both mislead.
- **Recommended solution.** Have the server echo the originating `ToolRow.id` (the `toolRowId` field already exists but is populated with `toolNo` at [server/index.ts:456](server/index.ts#L456)) and match on that; add a distinct `no-evidence` status.
- **Priority: Medium** · **Effort: Small**

### 4.15 — Placeholder text presented as analysis

- **Problem.** Every generated row gets `potentialEffect: 'Part quality issue - see checklist'`, `processStep: 'Injection Molding'`, `currentPreventionControl: 'Design review'`, `currentDetectionControl: 'Visual inspection'`, `responsibleFunction: 'Tooling Engineer'` — constants, not analysis. They appear verbatim in the Excel export.
- **Evidence.** [server/index.ts:459-471](server/index.ts#L459-L471).
- **Impact.** Exported FMEAs contain filler in four standard columns, which reviewers must either notice and rewrite or (worse) not notice.
- **Recommended solution.** Leave them blank and mark them as engineer-required fields in the UI/export, or derive effect text from the matched checklist `concern`.
- **Priority: Medium** · **Effort: Small**

### 4.16 — Minor issues

| Issue | Evidence | Priority |
|---|---|---|
| Error-dismiss button does nothing (`onClick={() => {}}`) | [src/components/CdiUploadPanel.tsx:129](src/components/CdiUploadPanel.tsx#L129) | Low |
| Blob URLs leaked on reset/re-upload (only `removeImage` revokes) | [src/components/ToolImageUploader.tsx:42](src/components/ToolImageUploader.tsx#L42) | Low |
| `nextShotActions` hard-coded `[]` — the UI branch can never render | [server/index.ts:598](server/index.ts#L598) | Low |
| `evidence_images_base64` always `[]`; `/api/knowledge/:id/images` never called by any component | [server/index.ts:783](server/index.ts#L783) | Low |
| `imgUrl` built with `http://` prefix — mixed-content block once TLS is enabled | [server/index.ts:544](server/index.ts#L544), [KnowledgeBase.tsx:96-100](src/components/knowledge/KnowledgeBase.tsx#L96-L100) | Medium |
| `AVG()` of S/O/D across unrelated tools sharing a failure mode | [server/index.ts:404-412](server/index.ts#L404-L412) | Medium |
| `getDefaultSeverity` keyword heuristic is undocumented and untested | [server/index.ts:43](server/index.ts#L43) | Low |
| `server/dist/` committed alongside sources and rebuilt by `update.sh` — stale-artifact risk | `server/dist/*.js` | Low |
| `let allRows` never reassigned | [src/services/cdiParser.ts:355](src/services/cdiParser.ts#L355) | Low |

---

## 5. Security risks

### 5.1 — No application-level authentication or authorization (Confirmed)

- **Problem.** The API trusts every request. The only barrier is nginx basic auth, which is a single shared credential with no identity, no roles, and no revocation.
- **Evidence.** [deploy/nginx-fmea.conf:9-11](deploy/nginx-fmea.conf#L9-L11); no auth middleware in [server/index.ts](server/index.ts).
- **Impact.** No attribution for any action; no way to implement the engineer-approval workflow the product requires; anyone with the shared password reads the full historical FMEA knowledge base (competitively sensitive manufacturing data). If port 3001 is ever exposed beyond `127.0.0.1`, the entire API is public.
- **Recommended solution.** Add SSO (the organisation almost certainly has Entra ID / Google Workspace) or session auth with `engineer` / `reviewer` / `admin` roles; enforce in Express middleware, not only in nginx.
- **Priority: Critical** · **Effort: Large**

### 5.2 — TLS certificate validation disabled on every database connection (Confirmed)

- **Problem.** `ssl: { rejectUnauthorized: false }` appears in all six connection sites.
- **Evidence.** [server/index.ts:30](server/index.ts#L30), [:144](server/index.ts#L144), [:326](server/index.ts#L326), [:1071](server/index.ts#L1071); [server/checklistService.ts:159](server/checklistService.ts#L159), [:308](server/checklistService.ts#L308), [:424](server/checklistService.ts#L424). Also `trustServerCertificate: true` in [server/db.ts:15](server/db.ts#L15).
- **Impact.** The connection is encrypted but unauthenticated — a MITM on the path to the database can impersonate it and harvest credentials and data. Common with RDS defaults, but it is a real exposure.
- **Recommended solution.** Ship the RDS/Postgres CA bundle and set `ssl: { ca, rejectUnauthorized: true }`. Make the insecure mode opt-in via an explicit env flag for local development only.
- **Priority: High** · **Effort: Small**

### 5.3 — Site is served over plain HTTP; basic-auth credentials sent in clear (Confirmed)

- **Problem.** The nginx server block listens on `:80` only, with no TLS and no redirect.
- **Evidence.** [deploy/nginx-fmea.conf:2-3](deploy/nginx-fmea.conf#L2-L3).
- **Impact.** The shared basic-auth password and every FMEA record traverse the network in clear text.
- **Recommended solution.** Certbot/ACM certificate, `listen 443 ssl`, permanent redirect from `:80`, HSTS. This also unblocks the mixed-content problem in §4.16.
- **Priority: Critical** · **Effort: Small**

### 5.4 — Wide-open CORS (Confirmed)

- **Problem.** `app.use(cors())` allows any origin.
- **Evidence.** [server/index.ts:39](server/index.ts#L39).
- **Impact.** Any website a logged-in user visits can issue cross-origin reads against the API. Basic auth limits the practical blast radius today (browsers won't attach credentials without them being cached), but it becomes a full CSRF/data-exfiltration surface the moment cookie-based auth is added.
- **Recommended solution.** `cors({ origin: process.env.ALLOWED_ORIGIN, credentials: true })`.
- **Priority: High** · **Effort: Small**

### 5.5 — Raw database error messages returned to the client (Confirmed)

- **Problem.** Every `catch` does `res.status(500).json({ error: error.message })`.
- **Evidence.** 11 occurrences, e.g. [server/index.ts:491](server/index.ts#L491), [:567](server/index.ts#L567), [:802](server/index.ts#L802).
- **Impact.** Postgres errors leak table names, column names, and constraint names — a free schema map for anyone probing the API.
- **Recommended solution.** Log the full error server-side with a correlation ID; return `{ error: "Internal server error", ref: id }`.
- **Priority: Medium** · **Effort: Small**

### 5.6 — 1.4 GB of proprietary engineering source files served as static assets (Confirmed)

- **Problem.** `public/` (copied verbatim into `dist/`, which is nginx's root) contains Mattel product design guidelines, Pro/E `.prt` models, AutoCAD `.dwg` drawings, and macro-enabled `.xlsm` standards.
- **Evidence.** `du -sh public/MEC` → 1.4 GB; [deploy/nginx-fmea.conf:6](deploy/nginx-fmea.conf#L6) sets `root /home/ubuntu/fmea/dist`; direct paths are exposed by [src/data/sourceMapping.json](src/data/sourceMapping.json) and fetched as `/MEC/${sourcePath}` at [src/components/standards/MecPageRenderer.tsx:120](src/components/standards/MecPageRenderer.tsx#L120).
- **Impact.** Every file is downloadable by anyone past the single shared password, with no per-document access control and no audit log. These are trade-secret-class CAD and product standards.
- **Recommended solution.** Move originals behind an authenticated `/api/documents/:slug` endpoint (signed S3 URLs with short TTL), keep only derived thumbnails public, and log access.
- **Priority: High** · **Effort: Medium**

### 5.7 — No rate limiting, no security headers, no request-size sanity on the generate path (Confirmed)

- **Problem.** No `express-rate-limit`, no `helmet`; `express.json({ limit: '10mb' })` is the only bound, and `tools[]` length is unchecked.
- **Evidence.** [server/index.ts:39-40](server/index.ts#L39-L40).
- **Impact.** A 10 MB `tools` array multiplies into an unbounded fan-out of DB queries (§4.8) — a cheap denial-of-service against the shared database.
- **Recommended solution.** `helmet()`, `express-rate-limit` on `/api/fmea/generate` and `/api/checklist/*`, and a hard cap on `tools.length` (e.g. 500) returning 413.
- **Priority: Medium** · **Effort: Small**

### 5.8 — Privacy notice is factually wrong (Confirmed)

- **Problem.** The upload panel states *"Parsed locally in your browser. No data is uploaded to any server."* Parsing is indeed local, but generation `POST`s the full `toolRows` array — including `rawRowData`, i.e. every parsed cell — to the API.
- **Evidence.** [src/components/CdiUploadPanel.tsx:140](src/components/CdiUploadPanel.tsx#L140) vs [src/services/fmeaGenerator.ts:104](src/services/fmeaGenerator.ts#L104).
- **Impact.** Users make disclosure decisions about confidential project data based on an incorrect statement.
- **Recommended solution.** Reword to "Parsed in your browser. Tool data is sent to the FMEA server only when you generate a draft."
- **Priority: Medium** · **Effort: Small**

### 5.9 — Positives worth recording

All SQL uses parameterized queries (`$1`, `$2`) — **no injection risk found**. `git grep` for hard-coded credentials in tracked files returned nothing; `.gitignore` correctly excludes `.env`, `server/.env`, and `deploy/fmea.env`, and `git ls-files` confirms only `.template`/`.example` files are tracked. Secrets are read from `process.env` throughout.

---

## 6. UI/UX issues

### 6.1 — Dark mode is roughly half-implemented (Confirmed)

- **Problem.** The toggle sets `.dark` globally, but several major components have zero `dark:` variants: `FmeaDraftTable` (0), `ProjectSummaryCard` (0), `MecProductStandards` (0), `EmptyState` (0), `LoadingState` (0), `StatusBadge` (0). `OverviewDashboard` (16) and `CdiUploadPanel` (16) are partly covered; `AppShell` and `KnowledgeBase` are well covered.
- **Evidence.** Per-file `grep -o 'dark:' | wc -l` counts, cited above.
- **Impact.** In dark mode the entire draft-results screen and project header render as white cards with light-grey text — the primary workflow becomes hard to read. Recharts axis/grid colours are also hard-coded (`#e2e8f0`, `#475569`).
- **Recommended solution.** Drive colours from the CSS custom properties already defined in [src/index.css](src/index.css) rather than literal Tailwind shades; audit each component; make chart colours theme-aware.
- **Priority: High** · **Effort: Medium**

### 6.2 — Modals are not accessible and cannot be dismissed with Escape (Confirmed)

- **Problem.** `DrilldownDrawer`, `ImageZoomModal`, and `ImageModal` have no `role="dialog"`, no `aria-modal`, no focus trap, no focus restore, and no Escape handler. Background content stays scrollable and focusable.
- **Evidence.** [src/components/dashboard/OverviewDashboard.tsx:92-128](src/components/dashboard/OverviewDashboard.tsx#L92-L128); [src/components/knowledge/KnowledgeBase.tsx:169-198](src/components/knowledge/KnowledgeBase.tsx#L169-L198).
- **Impact.** Keyboard and screen-reader users can open a drilldown and become stranded in it.
- **Recommended solution.** Use the native `<dialog>` element or a small focus-trap hook; add `onKeyDown` Escape; set `aria-labelledby` to the heading; lock body scroll.
- **Priority: High** · **Effort: Medium**

### 6.3 — Loading and error states are missing on the dashboard (Confirmed)

- **Problem.** `/api/dashboard/stats` has no loading state and no error state; failure is a bare `console.error`. An empty dashboard is indistinguishable from a broken one.
- **Evidence.** [src/App.tsx:79-87](src/App.tsx#L79-L87) — no `setState` in the `.catch`.
- **Impact.** During the multi-second unbounded fetch (§4.7) the user sees empty charts, then content appears; on failure they see empty charts forever with no explanation and no retry.
- **Recommended solution.** Add `isLoading` / `error` state, skeleton charts, and a retry button. (`LoadingState` and `EmptyState` components already exist and are used well elsewhere.)
- **Priority: High** · **Effort: Small**

### 6.4 — No confirmation before destructive reset (Confirmed)

- **Problem.** "Upload New File" clears metadata, all tool rows, all attached images, and all generated FMEA rows immediately.
- **Evidence.** [src/App.tsx:144-151](src/App.tsx#L144-L151), triggered by [ProjectSummaryCard.tsx:50](src/components/ProjectSummaryCard.tsx#L50).
- **Impact.** Combined with §4.5 (no persistence), one misclick destroys an hour of work irrecoverably.
- **Recommended solution.** Confirmation dialog when `fmeaRows.length > 0`.
- **Priority: High** · **Effort: Small**

### 6.5 — All failure modes start collapsed with no bulk expand (Confirmed)

- **Problem.** `expandedTools` and `expandedFailureModes` both start empty. Reviewing 20 tools × 8 failure modes requires ~180 individual clicks before any recommendation is visible.
- **Evidence.** [src/components/FmeaDraftTable.tsx:43-44](src/components/FmeaDraftTable.tsx#L43-L44).
- **Impact.** The core review task is punishing. Users will skip straight to Excel export, bypassing the app's own value.
- **Recommended solution.** Expand-all/collapse-all controls; auto-expand the first tool; remember expansion state across the Review view.
- **Priority: High** · **Effort: Small**

### 6.6 — Additional accessibility gaps (Confirmed)

| Gap | Evidence |
|---|---|
| Row checkboxes have no accessible name | [ToolingTable.tsx:170](src/components/ToolingTable.tsx#L170), [:209](src/components/ToolingTable.tsx#L209) — no `aria-label` |
| Loading/error regions are not announced | no `aria-live` / `role="status"` anywhere in `src/` |
| Tables have no `<caption>` and headers no `scope="col"` | [ToolingTable.tsx:183](src/components/ToolingTable.tsx#L183), [KnowledgeBase.tsx:538](src/components/knowledge/KnowledgeBase.tsx#L538) |
| Expand/collapse buttons lack `aria-expanded` | [FmeaDraftTable.tsx:161](src/components/FmeaDraftTable.tsx#L161), [:199](src/components/FmeaDraftTable.tsx#L199) |
| Evidence images use index-based alt text ("Evidence 1") | [KnowledgeBase.tsx:592](src/components/knowledge/KnowledgeBase.tsx#L592) |
| Sidebar collapse toggle has no label | [AppShell.tsx:166](src/components/layout/AppShell.tsx#L166) |
| `text-[10px]` / `text-[11px]` used widely for meaningful content | throughout — below comfortable minimums |
| No visible focus ring on custom buttons | most `<button>`s omit `focus-visible:` styling |

- **Priority: Medium** · **Effort: Medium**

### 6.7 — Layout and responsive issues (Confirmed)

- The generate view's fixed bottom bar uses `lg:left-[260px]` — hard-coded to the expanded sidebar, so it misaligns whenever the sidebar is collapsed to `72px` ([src/App.tsx:356](src/App.tsx#L356) vs [AppShell.tsx:60](src/components/layout/AppShell.tsx#L60)).
- `MecProductStandards` uses `h-[calc(100vh-120px)]` with a fixed `w-72` sidebar and no mobile treatment — unusable below ~900 px ([MecProductStandards.tsx:196-198](src/components/standards/MecProductStandards.tsx#L196-L198)).
- `ToolingTable` forces `min-w-[1400px]`; on a laptop nearly every column requires horizontal scrolling ([ToolingTable.tsx:165](src/components/ToolingTable.tsx#L165)).
- The "Failure Frequency" chart caption says *"top 15 failures"* but the data is `.slice(0, 8)` ([OverviewDashboard.tsx:349](src/components/dashboard/OverviewDashboard.tsx#L349) vs [:420](src/components/dashboard/OverviewDashboard.tsx#L420)).
- `parseWarnings` are keyed by message text (`key={w}`) — duplicate warnings collide ([src/App.tsx:304](src/App.tsx#L304)).
- **Priority: Medium** · **Effort: Small**

### 6.8 — Single 1.59 MB JS bundle, no code splitting (Confirmed)

- **Problem.** `dist/assets/index-vUIdVTjk.js` is 1,585,119 bytes. It statically includes `accessoriesRagData.ts` (5,090 lines), `accessory_tooling_ai_database.json` (4,472 lines), `mec_product_standard_v2.json` (2,717 lines), and `fmeaMockData.ts` (1,356 lines) — plus all of Recharts and SheetJS.
- **Evidence.** `ls -la dist/assets/`; imports at [src/data/baselineStandards.ts:7-9](src/data/baselineStandards.ts#L7-L9) and [src/data/mecProductStandardsV2.ts:1](src/data/mecProductStandardsV2.ts#L1).
- **Impact.** Slow first load on factory-floor connections; the standards corpus is downloaded by every user even if they only generate drafts.
- **Recommended solution.** `React.lazy` the dashboard (drops Recharts) and the standards browser (drops the JSON corpora); `import()` SheetJS on demand; consider serving the standards corpus from an API endpoint instead of bundling it.
- **Priority: Medium** · **Effort: Medium**

---

## 7. Recommended new features

Scoped to what this application actually is — no generic advice, nothing that already exists.

### 7.1 — Draft persistence and versioning
Tables `fmea_draft` / `fmea_draft_row`; `POST /api/fmea/draft`, `PATCH /api/fmea/draft/:id/row/:rowId`, `GET /api/fmea/drafts`. Prerequisite for §7.2, §7.3, and §7.7. **Priority: Critical · Effort: Large**

### 7.2 — Make the draft actually editable, then implement the Review screen
Wire the already-present `onEditRow` prop (§4.2 of the inventory): inline S/O/D steppers with live RPN recalculation, editable effect/cause/control fields, per-row accept / reject / needs-review with a reason. Add `review` and `export` to `navItems` so both existing screens become reachable. **Priority: Critical · Effort: Medium**

### 7.3 — Engineer sign-off workflow
The README states a qualified engineer must confirm every draft, but nothing enforces or records this. Add reviewer assignment, an approve action that freezes the draft, and a signed PDF/Excel export carrying approver name, timestamp, and a content hash. Depends on §5.1 and §7.1. **Priority: High · Effort: Large**

### 7.4 — Feedback loop from first shot back into the knowledge base
`fmea_case_timeline` already models `first_shot`, `first_shot_action`, and `next_shot` events, and the UI already renders them — but nothing can write them. Add a "log first-shot result" form so predicted failure modes get confirmed or refuted. This is what turns the tool from a one-way generator into a system that improves. **Priority: High · Effort: Large**

### 7.5 — Prediction accuracy dashboard
Once §7.4 exists: predicted-vs-actual hit rate by tool family, precision/recall of the checklist matcher, coverage gaps (tool descriptions that consistently return `"No historical data"`), and drift in S/O/D versus historical averages. Directly justifies the tool's continued investment. **Priority: Medium · Effort: Medium**

### 7.6 — Tool-description alias curator (admin)
The matcher's misses are almost all normalization misses (§4.1). An admin screen listing unmatched descriptions with a "map to canonical name" action — persisted to an `alias` table consulted by the shared normalizer — converts recurring failures into permanent fixes without a code deploy. **Priority: High · Effort: Medium**

### 7.7 — Cross-project comparison
Given two CDI uploads or two saved drafts, show which failure modes are shared, which are new, and which historically recurred. Tooling engineers reuse mould designs across toy lines constantly; the data to support this is already in `fmea_projects` + `fmea_knowledge_base`. **Priority: Medium · Effort: Medium**

### 7.8 — Workflow automation
- **Watched-folder ingest:** poll a shared drive for new CDI files and pre-generate drafts overnight, so the engineer opens a finished draft rather than waiting.
- **Weekly digest email:** new high-RPN modes and drafts awaiting review.
- **Checklist regeneration CI job:** `generate_checklist_standard.ts` currently runs by hand; schedule it with a verification gate (`verify_checklist_standard.ts` already exists) and publish a run report.

**Priority: Medium · Effort: Medium**

### 7.9 — Admin and reporting
Checklist coverage report (which tool families have zero entries), `fmea_checklist_standard.is_verified` / `verified_by` review queue (columns exist, nothing uses them), generation-run history with model and prompt version (`ai_model`, `prompt_version`, `generation_run_id` are all already stored), and an API health/metrics page. **Priority: Medium · Effort: Medium**

---

## 8. Prioritized roadmap

### Phase 1 — Trust and safety (1–2 weeks)
Nothing else matters while the tool can silently emit fabricated analysis.

1. Remove the silent mock-data fallback (§4.2)
2. Unify `normalizeToolDescription` into one shared module + repopulate the DB column (§4.1)
3. Enable HTTPS and enforce redirect (§5.3)
4. Fix RPN bucket thresholds (§4.4)
5. Fix draft row ID generation (§4.3)
6. Correct the privacy notice (§5.8)
7. Enable DB certificate verification (§5.2)

### Phase 2 — Make the workflow usable (2–4 weeks)
8. Draft persistence (§7.1)
9. Editable draft rows + reachable Review/Export navigation (§7.2)
10. Expand-all controls and reset confirmation (§6.5, §6.4)
11. Dashboard loading/error states (§6.3)
12. Resolve the image-upload feature — implement or remove (§4.6)

### Phase 3 — Performance and hardening (2–3 weeks)
13. SQL-side dashboard aggregation (§4.7)
14. Single pooled connection + batched S/O/D queries (§4.8)
15. Request validation, rate limiting, `helmet`, sanitized errors (§4.13, §5.5, §5.7)
16. Lock down CORS (§5.4)
17. Code-split the bundle (§6.8)

### Phase 4 — Access control and governance (3–5 weeks)
18. SSO + roles (§5.1)
19. Move MEC source documents behind authenticated access (§5.6)
20. Sign-off workflow (§7.3)
21. Alias curator (§7.6)

### Phase 5 — Learning loop (ongoing)
22. First-shot feedback capture (§7.4)
23. Accuracy dashboard (§7.5)
24. Cross-project comparison (§7.7)
25. Automation and admin reporting (§7.8, §7.9)

### Continuous
Dark-mode completion (§6.1), accessibility remediation (§6.2, §6.6), test coverage (§9.4), structured logging (§9.5).

---

## 9. Top five improvements to implement first

### 9.1 — Delete the silent mock-data fallback
[src/services/fmeaGenerator.ts:127-135](src/services/fmeaGenerator.ts#L127-L135). One `catch` block currently allows a database outage to produce a plausible-looking, entirely fictional FMEA that a user can export and act on. Replace with a thrown error surfaced through the existing `generateError` state. **~1 hour. Highest risk-reduction per line changed in the entire codebase.**

### 9.2 — Unify the three tool-description normalizers
Create `shared/normalizeToolDescription.ts`, import it from `src/`, `server/`, and `migration/`, re-run `populate_normalized_tool_descriptions.ts`, and add a golden-case test table. This is the root cause of missing historical evidence — the product's core value. **~1 day plus a data-repopulation run.**

### 9.3 — Fix RPN bucketing and draft row IDs
Two small, independent correctness fixes ([src/lib/normalization.ts:130](src/lib/normalization.ts#L130), [server/index.ts:455](server/index.ts#L455)) that respectively make risk prioritisation meaningful and stop rows from sharing React keys and expansion state. **~2 hours combined; confirm the bucket bands with engineering first.**

### 9.4 — Add tests for the paths that carry the risk
Current coverage is 17 tests over the legacy fallback engine, the standards loader, and `checklistSources` — i.e. it tests almost nothing that runs in production. Priority targets: `normalizeToolDescription` (golden cases), `calculateTextSimilarity` (the documented `"Bra"`/`"Bracelet"` and `"Leg"`/`"Leg LT"` guards have no tests), `cdiParser.parseCdiFile` against fixture workbooks, `excelExport` shape, and API integration tests against a test database. **~1 week to a defensible baseline.**

### 9.5 — Replace `console.log` with structured logging, and sanitize error responses
46 `console.*` calls in [server/index.ts](server/index.ts) alone, several logging full SQL and parameters ([:764](server/index.ts#L764)) — noisy, unsearchable in PM2, and a data-leak vector. Adopt `pino` with levels and request IDs; return generic errors with a correlation ID to clients (§5.5); add `/api/health` for the deploy check that `update.sh` currently performs against `/api/checklist/stats`. **~1 day.**

---

## 10. Questions and unclear requirements

**Product and workflow**

1. **Is the draft meant to be edited in the app, or exported and edited in Excel?** The README says "editable", the `onEditRow` prop exists, and the Review screen exists — but none of it is wired, and there is no way to save. The answer determines whether §7.1/§7.2 are essential or whether the app should be positioned as an export-only generator.
2. **Where does the approved FMEA end up?** If a downstream PLM/QMS is the system of record, the sign-off workflow (§7.3) may belong there and this tool only needs a clean handoff format.
3. **Were the Review and Export screens deliberately removed from navigation, or is that an oversight?** Both are complete and reachable only by URL.

**Data and matching**

4. **Are the RPN bucket boundaries (36 / 27 / 9) intentional?** They do not fit an S×O×D product. Is there a house convention, or should this move to AIAG-VDA Action Priority?
5. **Is averaging S/O/D across all tools sharing a failure mode acceptable** ([server/index.ts:404](server/index.ts#L404))? "Flash" on a torso and "flash" on an earring may not warrant the same severity.
6. **How should the `"No historical data"` placeholder behave?** It currently creates a draft row that is exported as if it were analysis. Should such tools be omitted, or flagged as "engineer input required"?
7. **How current is `tool_description_normalized`?** If the column has not been repopulated since `migration/normalizeToolDescription.ts` last changed, the drift in §4.1 may be wider than the code diff suggests. *(Assumption — needs a live query to confirm.)*

**Images and documents**

8. **What are tool-row images intended to do?** Feed a vision model, attach to the exported FMEA, or simply document the upload? Nothing consumes them today.
9. **Who is allowed to see the MEC source documents?** All 1.4 GB is currently served to anyone with the shared password, including CAD models and macro-enabled workbooks.

**Access and operations**

10. **Is basic auth the intended long-term control, or a placeholder?** The nginx comment ("no built-in login yet") suggests placeholder. Is there an SSO provider available?
11. **Who operates this in production?** There is no monitoring, no alerting, no error tracking, and no `/api/health`. If PM2 restarts on a crash loop, nobody is notified.
12. **Should `server/dist/` remain committed?** `update.sh` rebuilds it on deploy, so the committed artifacts are only a source of stale-code confusion.
13. **Is the 1.5 GB Git repository (plus 1.5 GB of LFS-tracked assets) sustainable?** Clone and CI times will keep degrading. Consider moving `public/MEC` to object storage referenced by manifest.

**Untracked work in progress**

14. `deck_assets/`, `deliverables/`, and `scripts/create_management_deck.ps1` are untracked and not ignored — should they be committed, or added to `.gitignore`?

---

### Confirmed vs. assumed — summary

**Confirmed by direct source inspection or command output:** every finding in §4, §5, and §6, plus the feature inventory and dead-code list. Line references are exact as of commit `4347031`.

**Assumptions explicitly flagged:** the practical scale of the `fmea_knowledge_base` payload in §4.7 (no DB access — the README's 1,726 checklist entries were used as a lower bound); the current freshness of `tool_description_normalized` in §4.1 (the code divergence is confirmed; the extent of resulting data drift is not); production deployment specifics beyond what `deploy/` declares; and the runtime behaviour of the OpenAI generation scripts in `migration/`, which were read but not executed.
