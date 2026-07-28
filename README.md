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

## Deploying to Ubuntu EC2

The prepared EC2 configuration uses:

```text
/home/ubuntu/fmea
```

It keeps the deployment separate from the existing website and SmartHost folder:

```text
Existing website       Existing Nginx configuration
SmartHost              Existing SmartHost configuration
FMEA frontend          /home/ubuntu/fmea/dist
FMEA API               127.0.0.1:3001
FMEA address           https://fmea.ptmi-online.com
```

The folder does not create the subdomain by itself. DNS sends the subdomain to EC2, and a separate Nginx configuration sends requests to the FMEA frontend and API.

### 1. Install the required Ubuntu packages

```bash
sudo apt update
sudo apt install -y nginx acl apache2-utils git-lfs
git lfs install
```

Install Node.js 20 or newer if it is not already installed:

```bash
node --version
npm --version
```

Install PM2 after Node.js is available:

```bash
npm install -g pm2
pm2 --version
```

If the global install reports a permission error and Node was installed system-wide, run `sudo npm install -g pm2`. When Node was installed with `nvm`, do not use `sudo`.

If PM2 already manages SmartHost under the `ubuntu` user, do not install PM2 again and do not create another PM2 startup service. Confirm the existing processes first:

```bash
pm2 list
```

FMEA uses the separate process name `fmea-api`. Starting or reloading that name does not restart the SmartHost process.

### 2. Clone and build the application

```bash
cd /home/ubuntu
git clone YOUR_PRIVATE_GITHUB_REPOSITORY fmea
cd fmea

git lfs pull
npm ci
npm --prefix server ci
npm run build:production
```

Only the frontend and runtime API dependencies are required on EC2. Migration/OpenAI dependencies are not required for normal Draft FMEA use.

### 3. Create the protected API configuration

```bash
sudo install -d -o root -g ubuntu -m 750 /etc/fmea
sudo cp deploy/fmea.env.example /etc/fmea/fmea.env
sudo chown root:ubuntu /etc/fmea/fmea.env
sudo chmod 640 /etc/fmea/fmea.env
sudo nano /etc/fmea/fmea.env
```

Replace every `CHANGE_ME` value with the production PostgreSQL settings. The runtime service does not need `OPENAI_API_KEY`.

### 4. Allow Nginx to read the built frontend

Nginx normally runs as `www-data`. Give it access only to the built frontend:

```bash
sudo setfacl -m u:www-data:x /home/ubuntu
sudo setfacl -R -m u:www-data:rX /home/ubuntu/fmea/dist
sudo setfacl -R -d -m u:www-data:rX /home/ubuntu/fmea/dist
```

Do not use `chmod -R 777`.

### 5. Protect the application with a password

The application does not yet have its own login page. Create an Nginx username and password before making the domain available:

```bash
sudo htpasswd -c /etc/nginx/.htpasswd-fmea YOUR_USERNAME
```

The supplied Nginx configuration requires this password. Do not remove the protection unless the site is already secured by company VPN, SSO, or another approved access layer.

### 6. Start and preserve the API with PM2

```bash
set -a
source /etc/fmea/fmea.env
set +a

pm2 start deploy/ecosystem.config.cjs --only fmea-api --env production
pm2 status
```

Test the API directly on EC2:

```bash
curl http://127.0.0.1:3001/api/checklist/stats
```

The response should report the `fmea_checklist_standard` entry count.

Make PM2 restore the API after an EC2 reboot:

```bash
pm2 startup
```

PM2 prints one `sudo ... pm2 startup ...` command. Copy and run that exact command, then save the current process list:

```bash
pm2 save
```

When PM2 startup is already configured for SmartHost, skip `pm2 startup` and only run `pm2 save` after adding FMEA. The saved PM2 process list will then contain both SmartHost and `fmea-api`.

Before starting FMEA, confirm SmartHost is not already using port `3001`:

```bash
sudo ss -ltnp | grep ':3001'
```

If port `3001` is occupied, choose another local port such as `3002` in `/etc/fmea/fmea.env` and update `proxy_pass` in `deploy/nginx-fmea.conf` to the same port.

Useful PM2 commands:

```bash
pm2 status
pm2 restart fmea-api
pm2 stop fmea-api
pm2 logs fmea-api --lines 100
```

### 7. Install the separate Nginx site

On Ubuntu:

```bash
sudo cp deploy/nginx-fmea.conf /etc/nginx/sites-available/fmea
sudo ln -s /etc/nginx/sites-available/fmea /etc/nginx/sites-enabled/fmea
sudo nginx -t
sudo systemctl reload nginx
```

This adds a separate `fmea.ptmi-online.com` server block. It does not replace the existing default website or SmartHost configuration.

If the real subdomain is different, edit `server_name` in `deploy/nginx-fmea.conf` before copying it.

### 8. Configure DNS and HTTPS

Create a DNS `A` record:

```text
fmea.ptmi-online.com → EC2 Elastic IP
```

The EC2 security group should allow:

- HTTP port 80;
- HTTPS port 443;
- SSH port 22 only from an approved office/VPN address.

Do not publicly open the API port `3001` or PostgreSQL port `5432`.

After DNS resolves to EC2, install the TLS certificate:

```bash
sudo certbot --nginx -d fmea.ptmi-online.com
sudo certbot renew --dry-run
```

Then open:

```text
https://fmea.ptmi-online.com
```

### Updating the EC2 deployment

The repository includes `deploy/update.sh`. It pulls only fast-forward Git changes, downloads Git LFS files, installs locked dependencies, rebuilds the frontend and API, verifies the API, and safely reloads Nginx.

Run:

```bash
cd /home/ubuntu/fmea
bash deploy/update.sh
```

If an update fails before the service restart, the previously running application remains available. Review the error instead of forcing a Git reset.

### Deployment files

| File | Purpose |
|---|---|
| `deploy/nginx-fmea.conf` | Routes `fmea.ptmi-online.com` to the frontend and API |
| `deploy/ecosystem.config.cjs` | Defines the API process managed by PM2 |
| `deploy/fmea.env.example` | Safe example of the production runtime settings |
| `deploy/update.sh` | Repeatable future update process |

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
