# AI FMEA Tooling Copilot

Local React prototype for drafting tooling FMEA rows from historical FMEA evidence.

## What It Does

- Shows an overview dashboard for historical FMEA rows, risk levels, status mix, failures, and material/gate patterns.
- Generates a draft FMEA from editable tool rows, including the `JLK25` CDI example from `JLK25-CDI-071925.xlsm`.
- Opens an evidence drawer for every AI suggestion with source project, tool, page tag, finding, recommendation, and similarity reasons.
- Includes Baseline Standards (Tooling) under Product Standards > Other Product Standards, with accessory checkpoints and visual references rendered in the shared standards article format.
- Provides a searchable knowledge base with project, family, material, gate, failure, status, and RPN filters.
- Simulates image upload detections and maps visual features to likely tooling risks.
- Supports review state changes, reviewer comments, CSV export, table copy, and print preview.

## How The Mock AI Works

The generator is deterministic and lives in `src/lib/fmeaEngine.ts`.

For each new tool, it normalizes the tool description, scores historical cases, groups matches by failure, and returns only suggestions with historical evidence. The scoring rules are:

- `+45` exact normalized family
- `+15` same material
- `+10` same gate type
- `+10` repeated failure in the same family
- `+10` closed First Shot or Next Shot status
- `+5` recommendation includes dimensional or action detail
- `-15` rejected, impossible, break-risk, or supplier-comment evidence

Confidence is derived from evidence score:

- High: `>= 80`
- Medium: `55-79`
- Low: `< 55`

Severity, occurrence, and detection come from `src/data/fmeaMockData.ts`; RPN is always calculated as `S * O * D`.

## Prerequisites

- Node.js 20 or newer
- Git LFS (required for the retained engineering source files)

## How To Run

```bash
git lfs install
git lfs pull
npm ci
npm --prefix server ci
cp .env.template .env
cp server/.env.template server/.env
npm run dev
```

Fill in only the credentials needed for the features you use. The real `.env` files are ignored and must never be committed.

Build, test, and type-check both the application and server:

```bash
npm run check
```

Regenerate the accessory tooling standards from `Copy of Standart Accesoris_Updated.xlsx` using the OpenAI credentials in `migration/.env`:

```bash
npm run generate:accessory-standards
```

The quality-first generator uses GPT-5.6 Sol, high-detail vision, source-evidence validation, and image relevance/deduplication. It is resumable; model-specific intermediate API results are cached under `migration/accessory_baseline_ai_work/`, while the validated application database is written to `src/data/accessory_tooling_ai_database.json`.

Regenerate the known Product Standards articles that require translation or source repair, then clean duplicate pages, sections, image references, and source mappings:

```bash
npm run generate:product-standards
```

Run the deterministic Product Standards cleanup without making API requests:

```bash
node scripts/regenerate_product_standards.cjs --cleanup-only
```

Preview unused extracted Product Standards images, or remove only files that are
not referenced by the current standards database:

```bash
npm run prune:assets
npm run prune:assets -- --apply
```

## Data Assumptions

The mock data is stored under `src/data` and uses realistic labels from the provided FMEA file names, project codes, and requested search examples.

`src/data/baselineStandards.ts` contains the structured baseline checklist used by the application. Product-standard JSON files and their source assets are intentionally retained as database inputs.

The original engineering documents under `public/MEC` are intentionally retained and tracked with Git LFS. Generated databases under `src/data` and migration JSON are also retained. Build output, installed dependencies, logs, editor settings, API caches, and secret-bearing environment files are excluded from Git.

## Publishing To GitHub

This repository contains a large engineering source archive and may contain proprietary material. Verify that you have permission to publish it and prefer a private GitHub repository unless the documents are approved for public release.

Before the first push:

```bash
git lfs install
git add .gitattributes .gitignore
git add .
git lfs ls-files
git status
git commit -m "Prepare AI FMEA repository"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Review `git status` before committing. Do not use `git add -f` for ignored environment files.

`src/data/cdiMockData.ts` is a compact extraction from the `TOOL PLAN` sheet in `JLK25-CDI-071925.xlsm`. It preserves key CDI fields used by the draft generator: tool no, reference part number, part description, quantity per toy, cavity, resin material, cycle time, weekly capacity, gating, insert material, part weight, tool aid, tool build, size, slide count, color, machine tonnage, and tool class.

The PDF files are not parsed by this prototype; their names are represented as source tags and page references in the mock historical rows.

## Next Steps

- Extract structured rows from the real PDFs and Excel master file.
- Add PDF page image/crop extraction for evidence thumbnails.
- Store historical cases in a vector index for semantic retrieval.
- Replace the deterministic mock generator with AI/RAG drafting while keeping the scoring engine as an audit layer.
- Add authentication, persistent review history, and controlled FMEA export templates.
