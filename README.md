# AI FMEA Tooling Copilot

AI FMEA Tooling Copilot helps tooling engineers create a first-draft FMEA from a CDI or tool-plan workbook.

The draft combines:

- previous FMEA experience;
- MEC Product Standards;
- Baseline Tooling Standards;
- historical severity, occurrence, and detection values.

The result is a starting point for engineering review. It is not an automatically approved FMEA.

> A qualified engineer must confirm the failure modes, concerns, recommendations, scores, responsibilities, and final approval.

## What the application does

An engineer uploads an `.xlsx` or `.xlsm` CDI file. The application:

1. Reads the project and tool information.
2. Standardizes tool names so they can be matched consistently.
3. Finds relevant historical failure modes.
4. Adds relevant failure modes from MEC and Baseline Standards.
5. Retrieves concerns and recommendations from the combined checklist.
6. Uses historical S/O/D values when available.
7. Calculates the RPN:

   ```text
   RPN = Severity × Occurrence × Detection
   ```

8. Displays an editable Draft FMEA.
9. Allows the result to be exported for further review.

OpenAI is used when preparing the knowledge and checklist data. It is not called every time an engineer generates a draft, so normal Draft FMEA generation remains fast and repeatable.

## Understanding the evidence labels

Each recommendation in Draft FMEA shows where it came from.

| Label | Meaning |
|---|---|
| **Previous FMEA** | Learned from completed historical FMEA records |
| **MEC Product Standard** | Supported by a Product Standard in the Knowledge section |
| **Baseline Tooling Standard** | Supported by the Baseline Standards (Tooling) database |

One recommendation can show more than one label. For example:

```text
Previous FMEA + MEC Product Standard
```

This means the historical recommendation was retained and strengthened with a relevant standard.

Standards-only recommendations display the standard label and source-document title. Failure-mode headers also show how many recommendations came from each source.

Excel exports contain:

- Source
- Standard Document
- Standard Section
- Concern
- Recommendation
- Supporting Cases
- S/O/D and RPN

The old placeholder rows saying “MEC Standard — Coming soon” have been removed.

## Current combined checklist

Draft FMEA uses the PostgreSQL table:

```text
public.fmea_checklist_standard
```

The original `fmea_checklist` table is preserved and is not changed by the combined-checklist generator.

The verified generation completed on 28 July 2026 contains:

| Item | Count |
|---|---:|
| Total combined entries | 1,726 |
| Original historical entries preserved | 1,330 |
| Entries with standard references | 428 |
| Product Standard entries | 306 |
| Baseline Standard entries | 131 |
| Tools covered | 251 |
| Duplicate concern/recommendation pairs | 0 |
| Missing historical entries | 0 |
| Invalid standard references | 0 |

The generator uses `gpt-5.6-terra` with low reasoning by default. This model was selected as a practical balance between quality and API cost. It does not use the older `gpt-4o-mini` value from `OPENAI_MODEL`.

## Project structure

The most important folders are:

```text
AI FMEA/
├── src/                         Frontend application
│   ├── components/              Screens and tables
│   ├── data/                    Product and Baseline Standards data
│   ├── services/                CDI parsing, API calls, and exports
│   ├── types/                   Shared data definitions
│   └── utils/                   Matching and export helpers
├── server/                      Runtime API and PostgreSQL access
├── migration/                   Database and checklist preparation
├── scripts/                     Standards maintenance scripts
├── public/MEC/                  Original Product Standards documents
├── public/mec_images/           Images used by Product Standards
├── rag_package/                 Baseline Standards source evidence
└── README.md                    Main handover document
```

Important files:

| File | Purpose |
|---|---|
| `server/index.ts` | Generates Draft FMEA rows |
| `server/checklistService.ts` | Retrieves combined checklist recommendations |
| `src/components/FmeaDraftTable.tsx` | Displays evidence labels and recommendations |
| `src/data/mec_product_standard_v2.json` | Product Standards shown in the application |
| `src/data/accessory_tooling_ai_database.json` | Baseline Tooling Standards |
| `migration/generate_checklist_standard.ts` | Builds the combined checklist |
| `migration/verify_checklist_standard.ts` | Checks preservation, duplicates, and references |
| `migration/create_checklist_standard_table.sql` | Defines the combined database table |

Do not delete the original documents, current JSON databases, migration source data, or generation scripts unless their replacement and recovery method are confirmed.

## Requirements

Install these before setting up the project:

- Node.js 20 or newer
- npm
- Git
- Git LFS
- PostgreSQL access

An OpenAI API key is only required when regenerating AI-prepared standards or checklist data.

## First-time setup

From the project folder:

```powershell
cd "C:\AI FMEA"
git lfs install
git lfs pull
npm run install:all
```

`npm run install:all` installs the frontend, server, and migration dependencies.

This step fixes errors such as:

```text
'vite' is not recognized
'ts-node' is not recognized
```

## Environment configuration

Copy the example configuration:

```powershell
Copy-Item migration\.env.template migration\.env
```

Fill in the required database values:

```text
PG_HOST
PG_PORT
PG_USER
PG_PASSWORD
PG_DATABASE
```

For offline AI generation, also add:

```text
OPENAI_API_KEY
```

Combined-checklist settings:

```text
CHECKLIST_STANDARD_MODEL=gpt-5.6-terra
CHECKLIST_STANDARD_REASONING_EFFORT=low
CHECKLIST_STANDARD_EMBEDDING_MODEL=text-embedding-3-small
CHECKLIST_STANDARD_CONCURRENCY=3
```

`migration/.env` is ignored by Git. Never commit it or copy its secrets into frontend variables.

## Starting the application

Use two PowerShell terminals.

Terminal 1 — start the API:

```powershell
cd "C:\AI FMEA"
npm run dev:server
```

Terminal 2 — start the frontend:

```powershell
cd "C:\AI FMEA"
npm run dev
```

Open the address printed by Vite, normally:

```text
http://localhost:5173
```

The API normally runs at:

```text
http://localhost:3001
```

If server code changes, restart the API. If a previously generated draft does not show evidence labels, refresh the browser and generate the draft again.

## Typical user workflow

1. Start the API and frontend.
2. Open the application.
3. Upload a CDI/tool-plan workbook.
4. Review the detected project and tool information.
5. Generate Draft FMEA.
6. Expand a tool and failure mode.
7. Review the source badge for every recommendation.
8. Confirm the standard-document title where shown.
9. Review and adjust S/O/D values.
10. Export the reviewed draft.

When no server or database is available, parts of the application can use bundled fallback data. Live database searches, dashboard information, and the complete combined checklist still require the API.

## Rebuilding the combined checklist

The combined checklist uses:

- every current row from `fmea_checklist`;
- Product Standards JSON;
- Product Standard source mappings;
- approved/high-confidence Baseline Tooling Standards.

Before a full rebuild:

1. Confirm that `migration/.env` points to the correct database.
2. Back up the database.
3. Review recently changed Product and Baseline Standards.
4. Run a small dry run.

Small dry run:

```powershell
npm --prefix migration run checklist-standard:generate -- --dry-run --limit 5
```

Test one source:

```powershell
npm --prefix migration run checklist-standard:generate -- --dry-run --source headband-design-guidelines
```

Full generation:

```powershell
npm --prefix migration run checklist-standard:generate
```

Required verification:

```powershell
npm --prefix migration run checklist-standard:verify
```

The full generation is billable because it uses the OpenAI API. Completed source and merge results are cached locally, allowing interrupted runs to continue without paying for the same completed work again.

The cache is stored under:

```text
migration/checklist_standard_work/
```

This folder is ignored by Git.

### Built-in quality protections

The generator:

- keeps every historical checklist entry;
- requires standard evidence for new controls;
- rejects unsupported dimensions and numbers;
- does not invent a specific defect when the source does not mention it;
- restricts Product Standards to matching tool families;
- prevents general guidance from creating the same failure for every tool;
- detects duplicate concern/recommendation pairs;
- verifies source-document references;
- falls back to unchanged, validated text when an AI merge fails;
- writes the new table only after validation succeeds.

## Maintaining Product and Baseline Standards

Rebuild Baseline Standards:

```powershell
npm run generate:accessory-standards
```

Rebuild configured Product Standards:

```powershell
npm run generate:product-standards
```

Run Product Standards cleanup without an API call:

```powershell
node scripts\regenerate_product_standards.cjs --cleanup-only
```

Preview unused Product Standard images:

```powershell
npm run prune:assets
```

Apply the approved image cleanup:

```powershell
npm run prune:assets -- --apply
```

The cleanup only checks extracted images against current Product Standard references. It does not delete the original documents in `public/MEC`.

Review generated standards before publishing. Confirm that:

- descriptions are in clear English;
- images are readable;
- blurry duplicate previews are removed;
- the retained image is the higher-quality version;
- document titles and source mappings are correct;
- repeated sections are removed;
- dimensions match the original source.

## Validation before committing

Run:

```powershell
npm run check
```

This checks:

- application tests;
- Product Standards data integrity;
- checklist source-label behavior;
- frontend compilation;
- production build;
- server compilation.

The application currently builds successfully. Vite may report that the main JavaScript file is large; this is a performance warning rather than a build failure.

## Checking the database

Confirm the current database and table:

```sql
SELECT current_database(), current_schema();

SELECT COUNT(*)
FROM public.fmea_checklist_standard;
```

If the table is not visible in pgAdmin:

1. Confirm that the selected database matches `PG_DATABASE`.
2. Open `Schemas > public > Tables`.
3. Right-click `Tables`.
4. Select **Refresh**.

To confirm that the API is using the combined table, open:

```text
http://localhost:3001/api/checklist/stats
```

The `total_entries` value should match `fmea_checklist_standard`.

## Common problems

### `vite` is not recognized

Run:

```powershell
cd "C:\AI FMEA"
npm run install:all
npm run dev
```

### `ts-node` is not recognized

Run:

```powershell
cd "C:\AI FMEA"
npm run install:all
npm run dev:server
```

### The app only shows Previous FMEA

1. Confirm the API is running with the latest code.
2. Refresh the browser.
3. Generate Draft FMEA again.
4. Expand the failure mode.
5. Look for MEC Product Standard or Baseline Tooling Standard badges.
6. Check `/api/checklist/stats` and confirm it reports the combined-table count.

Older draft data loaded before the server update may not contain source information.

### The database table cannot be found

Confirm that the database client and `migration/.env` use the same host and database. The table is under the `public` schema:

```text
public.fmea_checklist_standard
```

### The API cannot connect to PostgreSQL

Check:

- VPN/network access;
- database hostname and port;
- username and password;
- database name;
- firewall or RDS access rules.

Do not print the password or API key into logs while troubleshooting.

## Preparing the repository for GitHub

Keep the repository private unless the engineering documents are approved for public release.

Before committing:

```powershell
git lfs install
git status
npm run check
git add .
git lfs ls-files
git status
git commit -m "Prepare AI FMEA application"
```

Connect the repository:

```powershell
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Before pushing, confirm that these are not staged:

- `migration/.env`
- API keys
- database passwords
- local generation caches
- temporary logs

Large Office, PDF, CAD, image, and media files are managed through Git LFS.

## Security and engineering responsibility

- Keep API keys and database credentials out of Git.
- Do not expose credentials through variables beginning with `VITE_`.
- Treat CDI files, FMEA records, source documents, and engineering images as confidential.
- Use a database account with only the permissions it needs.
- Back up the database before a full migration or checklist rebuild.
- Add authentication and role-based access before wider deployment.
- Review all model-generated content before approval.
- Process only trusted workbooks.

## Handover checklist

Before transferring the application to another engineer:

- Confirm they can clone the repository and download Git LFS files.
- Provide credentials through an approved secure channel.
- Explain which database is development, test, and production.
- Demonstrate how to start both the API and frontend.
- Demonstrate CDI upload and Draft FMEA generation.
- Explain the three evidence badges.
- Demonstrate Product and Baseline Standards pages.
- Demonstrate Excel export.
- Run `npm run check`.
- Run the combined-checklist verification.
- Confirm database backup and restore procedures.
- Record the latest checklist generation date and model.
- Transfer ownership of OpenAI billing and GitHub LFS quotas where applicable.

If the README and application behavior ever differ, verify the current code and database first, then update this document in the same change.
