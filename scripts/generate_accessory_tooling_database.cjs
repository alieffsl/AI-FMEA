const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const iconv = require("iconv-lite");
const XLSX = require("xlsx");
const { OpenAI } = require("openai");
require("dotenv").config({ path: path.join(__dirname, "../migration/.env") });

const ROOT = path.join(__dirname, "..");
const WORKBOOK_PATH = path.join(ROOT, "Copy of Standart Accesoris_Updated.xlsx");
const IMAGE_INDEX_PATH = path.join(ROOT, "rag_package/data/image_index.csv");
const DRAWING_TEXT_PATH = path.join(ROOT, "rag_package/data/drawing_text_index.csv");
const RAG_ROOT = path.join(ROOT, "rag_package");
const OUTPUT_PATH = path.join(ROOT, "src/data/accessory_tooling_ai_database.json");

const MODEL = process.env.ACCESSORY_OPENAI_MODEL || "gpt-5.6-sol";
const IMAGE_REASONING_EFFORT = process.env.ACCESSORY_IMAGE_REASONING_EFFORT || "low";
const SYNTHESIS_REASONING_EFFORT = process.env.ACCESSORY_REASONING_EFFORT || "medium";
const WORK_DIR = path.join(
  ROOT,
  "migration/accessory_baseline_ai_work",
  MODEL.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
);
const CONCURRENCY = Math.max(1, Number(process.env.ACCESSORY_CONCURRENCY || process.env.CONCURRENCY || 2));
const IMAGE_BATCH_SIZE = Math.max(1, Number(process.env.ACCESSORY_IMAGE_BATCH_SIZE || 4));
const IMAGE_DETAIL = process.env.ACCESSORY_IMAGE_DETAIL || "high";
const MAX_OUTPUT_TOKENS = Math.max(4000, Number(process.env.ACCESSORY_MAX_OUTPUT_TOKENS || 12000));
const FORCE = process.argv.includes("--force") || process.env.ACCESSORY_FORCE_REPROCESS === "true";
const SHEET_FILTER = getArgValue("--sheet");
const DRY_RUN = process.argv.includes("--dry-run");

if (!fs.existsSync(WORKBOOK_PATH)) throw new Error(`Workbook not found: ${WORKBOOK_PATH}`);
if (!process.env.OPENAI_API_KEY && !DRY_RUN) throw new Error("OPENAI_API_KEY is missing from migration/.env");

const openai = DRY_RUN ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function repairTextEncoding(value) {
  if (typeof value !== "string" || !/[ÃÂâåèæç]/.test(value)) return value;
  const repaired = iconv.decode(iconv.encode(value, "win1252"), "utf8");
  const artifacts = (text) => (text.match(/[ÃÂâåèæç�]/g) || []).length;
  return artifacts(repaired) < artifacts(value) ? repaired : value;
}

function repairDeep(value) {
  if (typeof value === "string") return repairTextEncoding(value);
  if (Array.isArray(value)) return value.map(repairDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, repairDeep(item)]));
  }
  return value;
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function displaySheetName(value) {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/Assy\b/, "Assembly")
    .replace(/Ptmi\b/, "PTMI")
    .replace(/Vum\b/, "VUM");
}

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha1").update(value).digest("hex").slice(0, 10)}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = (rows.shift() || []).map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
  );
  return rows.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])),
  );
}

function readCsv(filePath) {
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function groupBy(rows, key) {
  return rows.reduce((groups, row) => {
    const value = row[key];
    (groups[value] ||= []).push(row);
    return groups;
  }, {});
}

function sheetCells(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const lines = [];
  rows.forEach((row, rowIndex) => {
    const values = row
      .map((value, columnIndex) => ({ value: String(value).trim(), address: XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex }) }))
      .filter((cell) => cell.value);
    if (values.length) lines.push(values.map((cell) => `${cell.address}: ${cell.value}`).join(" | "));
  });
  return lines;
}

function extractReferenceTables(sheetName, sheet) {
  if (sheetName !== "HANDRING") return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const columns = (rows[0] || []).map((value) => String(value).replace(/\s+/g, " ").trim());
  const dataRows = rows.slice(1)
    .map((row) => columns.map((_, index) => String(row[index] ?? "").replace(/\s+/g, " ").trim()))
    .filter((row) => row.some(Boolean));
  if (columns.filter(Boolean).length < 3 || dataRows.length === 0) return [];
  return [{
    title: "Handring Tool Reference",
    columns,
    rows: dataRows,
  }];
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" })[extension] || "";
}

function imageDataUrl(filePath) {
  const mime = mimeType(filePath);
  if (!mime) return "";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

const evidenceSchema = {
  type: "object",
  properties: {
    source_type: { type: "string", enum: ["cell", "image", "drawing_text"] },
    reference: { type: "string" },
    observation: { type: "string" },
  },
  required: ["source_type", "reference", "observation"],
  additionalProperties: false,
};

const imageAnalysisSchema = {
  type: "object",
  properties: {
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          image_id: { type: "string" },
          caption: { type: "string" },
          observed_text: { type: "array", items: { type: "string" } },
          observed_dimensions: { type: "array", items: { type: "string" } },
          observed_design_features: { type: "array", items: { type: "string" } },
          checkpoint_candidates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                requirement: { type: "string" },
                verification_method: { type: "string" },
                visible_evidence: { type: "string" },
              },
              required: ["requirement", "verification_method", "visible_evidence"],
              additionalProperties: false,
            },
          },
          uncertainties: { type: "array", items: { type: "string" } },
          use_as_visual_reference: { type: "boolean" },
          visual_quality: { type: "string", enum: ["high", "acceptable", "unusable"] },
          redundant_with: { type: "string" },
        },
        required: ["image_id", "caption", "observed_text", "observed_dimensions", "observed_design_features", "checkpoint_candidates", "uncertainties", "use_as_visual_reference", "visual_quality", "redundant_with"],
        additionalProperties: false,
      },
    },
  },
  required: ["images"],
  additionalProperties: false,
};

const sheetSchema = {
  type: "object",
  properties: {
    checkpoints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          requirement: { type: "string" },
          category: { type: "string", enum: ["assembly_fit", "dimension_geometry", "safety_edge", "material_process", "mold_tooling", "decoration_marking", "general_design"] },
          verification_method: { type: "string" },
          acceptance_criteria: { type: "string" },
          applicability: { type: "string" },
          evidence: { type: "array", items: evidenceSchema },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          review_required: { type: "boolean" },
        },
        required: ["title", "requirement", "category", "verification_method", "acceptance_criteria", "applicability", "evidence", "confidence", "review_required"],
        additionalProperties: false,
      },
    },
  },
  required: ["checkpoints"],
  additionalProperties: false,
};

async function structuredCompletion(name, schema, messages, maxTokens = MAX_OUTPUT_TOKENS) {
  let lastError;
  let outputTokenLimit = maxTokens;
  const reasoningEffort = name === "accessory_image_analysis"
    ? IMAGE_REASONING_EFFORT
    : SYNTHESIS_REASONING_EFFORT;
  const maxAttempts = Math.max(3, Number(process.env.ACCESSORY_RETRY_ATTEMPTS || 7));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await openai.responses.create({
        model: MODEL,
        reasoning: { effort: reasoningEffort },
        input: messages,
        max_output_tokens: outputTokenLimit,
        text: { format: { type: "json_schema", name, strict: true, schema } },
      });
      if (response.status === "incomplete") {
        const reason = response.incomplete_details?.reason || "unknown reason";
        const error = new Error(`OpenAI response incomplete: ${reason}`);
        error.code = reason;
        throw error;
      }
      const content = response.output_text;
      if (!content) throw new Error("OpenAI returned no JSON content");
      return repairDeep(JSON.parse(content));
    } catch (error) {
      lastError = error;
      const retryable =
        error?.code === "max_output_tokens" ||
        error?.status === 408 ||
        error?.status === 409 ||
        error?.status === 429 ||
        error?.status >= 500;
      if (!retryable) throw error;
      if (attempt < maxAttempts) {
        if (error?.code === "max_output_tokens") {
          outputTokenLimit = Math.min(32000, outputTokenLimit * 2);
          console.warn(`OpenAI request ${name} reached its output limit; retrying with ${outputTokenLimit} tokens.`);
          continue;
        }
        const retryAfterHeader = error?.headers?.get?.("retry-after-ms") || error?.headers?.get?.("retry-after");
        const retryAfter = Number(retryAfterHeader);
        const headerDelay = Number.isFinite(retryAfter)
          ? (retryAfterHeader === error?.headers?.get?.("retry-after") ? retryAfter * 1000 : retryAfter)
          : 0;
        const delay = Math.max(headerDelay, Math.min(60000, 3000 * (2 ** (attempt - 1)))) + Math.floor(Math.random() * 750);
        console.warn(`OpenAI request ${name} failed (attempt ${attempt}/${maxAttempts}); retrying in ${Math.round(delay / 1000)}s: ${error.status || ""} ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function analyzeImageBatch(sheetName, images, batchNumber) {
  const cachePath = path.join(WORK_DIR, slugify(sheetName), `images-${batchNumber}.json`);
  if (!FORCE && fs.existsSync(cachePath)) return repairDeep(JSON.parse(fs.readFileSync(cachePath, "utf8")));

  const content = [{
    type: "input_text",
    text: `Analyze every supplied image from the accessory tooling sheet "${sheetName}" independently.\n\nRules:\n- Report only text, dimensions, geometry, annotations, and relationships visibly supported by the image.\n- Preserve units and qualifiers exactly. Never invent a dimension or acceptance limit.\n- A checkpoint candidate must cite what is visibly shown; if the image is only a product photo, describe it and leave candidates empty.\n- Treat arrows, redlines, good/bad comparisons, section views, and callouts as evidence.\n- Set use_as_visual_reference=false for decorative, irrelevant, unreadable, or redundant images.\n- Set visual_quality=unusable when engineering content cannot be read clearly enough to support the standard.\n- When an image repeats another image in this batch, set redundant_with to the earlier image_id; otherwise return an empty string.\n- Put unclear or unreadable items in uncertainties.\n- Write captions and observations in professional English, translating source text when necessary.\n- Return one result for each exact image_id.`,
  }];

  for (const image of images) {
    const filePath = path.join(RAG_ROOT, image.extracted_file);
    const dataUrl = fs.existsSync(filePath) ? imageDataUrl(filePath) : "";
    content.push({ type: "input_text", text: `IMAGE ${image.image_id}; anchor ${image.anchor}; nearby workbook text: ${image.related_text_context || "none"}` });
    if (dataUrl) content.push({ type: "input_image", image_url: dataUrl, detail: IMAGE_DETAIL });
    else content.push({ type: "input_text", text: `[Image unavailable or unsupported: ${image.extracted_file}]` });
  }

  const result = await structuredCompletion(
    "accessory_image_analysis",
    imageAnalysisSchema,
    [{ role: "developer", content: "You are a mechanical tooling standards analyst performing evidence-faithful vision extraction." }, { role: "user", content }],
    Math.max(2200, MAX_OUTPUT_TOKENS),
  );
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
  return result;
}

async function synthesizeSheet(sheetName, cells, drawingRows, imageRows, imageAnalyses) {
  const cachePath = path.join(WORK_DIR, slugify(sheetName), "standard.json");
  if (!FORCE && fs.existsSync(cachePath)) return repairDeep(JSON.parse(fs.readFileSync(cachePath, "utf8")));

  const eligibleImageIds = new Set(
    imageAnalyses
      .filter((analysis) =>
        analysis.use_as_visual_reference &&
        analysis.visual_quality !== "unusable" &&
        !analysis.redundant_with
      )
      .map((analysis) => analysis.image_id),
  );
  const sourceReferences = new Set([
    ...cells.flatMap((line) => [...line.matchAll(/(?:^|\| )([A-Z]+\d+):/g)].map((match) => match[1])),
    ...drawingRows.map((row) => row.text_id),
    ...eligibleImageIds,
  ]);
  const input = {
    sheet_name: sheetName,
    workbook_cells: cells,
    drawing_text: drawingRows.map((row) => ({ id: row.text_id, text: row.drawing_text, anchor: row.anchor })),
    image_analysis: imageAnalyses,
  };

  const result = await structuredCompletion(
    "accessory_tooling_standard",
    sheetSchema,
    [
      { role: "developer", content: "You convert engineering workbook evidence into concise, auditable tooling checkpoints. Evidence fidelity is more important than completeness." },
      { role: "user", content: `Create the tooling checklist for one accessory sheet from the JSON evidence below.\n\nStrict rules:\n- Write all user-facing text in clear professional English. Translate Chinese source text accurately without retaining Chinese prose.\n- Do not add common engineering knowledge unless explicitly supported by the supplied cells, drawing text, or image observations.\n- Every checkpoint must include at least one evidence reference using an exact cell address, drawing text id, or an image id marked use_as_visual_reference=true.\n- Ignore images marked unusable, redundant, or unsuitable as visual references.\n- Preserve numeric values and units exactly; do not normalize, interpolate, or infer tolerances.\n- Merge duplicates that express the same requirement.\n- Do not split one rule into model, actual, verification, and reference checkpoints. Keep one actionable checkpoint per distinct requirement.\n- Do not repeat the requirement in verification_method, acceptance_criteria, or applicability. Leave optional text empty when it adds no information.\n- If evidence is ambiguous, use low confidence and set review_required=true. Do not invent a generic review note.\n- acceptance_criteria may be empty when the source gives no measurable limit.\n- Omit descriptive or non-actionable information; this is a working checklist, not a narrative summary.\n\nEvidence:\n${JSON.stringify(input)}` },
    ],
  );

  const checkpoints = [];
  const seen = new Set();
  for (const checkpoint of result.checkpoints) {
    const key = checkpoint.requirement.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const validEvidence = checkpoint.evidence.filter((item) => sourceReferences.has(item.reference));
    checkpoints.push({
      ...checkpoint,
      id: stableId("CHK", `${sheetName}|${key}`),
      evidence: validEvidence,
      confidence: validEvidence.length ? checkpoint.confidence : "low",
      review_required: checkpoint.review_required || validEvidence.length === 0,
    });
  }

  const analysisById = Object.fromEntries(imageAnalyses.map((analysis) => [analysis.image_id, analysis]));
  const standard = {
    id: `tooling-${slugify(sheetName)}`,
    slug: `tooling-baseline-${slugify(sheetName)}`,
    title: displaySheetName(sheetName),
    source_sheet: sheetName,
    source_workbook: path.basename(WORKBOOK_PATH),
    summary: "",
    checkpoints,
    reference_notes: [],
    quality_notes: [],
    images: imageRows.filter((image) => eligibleImageIds.has(image.image_id)).map((image) => {
      const analysis = analysisById[image.image_id] || {};
      return {
        image_id: image.image_id,
        asset_url: `/rag-assets/${image.thumbnail_file.replace(/\\/g, "/")}`,
        original_asset_url: `/rag-assets/${image.extracted_file.replace(/\\/g, "/")}`,
        anchor: image.anchor,
        caption: analysis.caption || `Source image ${image.image_id}`,
        observed_text: analysis.observed_text || [],
        uncertainties: analysis.uncertainties || [],
      };
    }),
    evidence_counts: {
      populated_cells: cells.reduce((sum, line) => sum + (line.match(/[A-Z]+\d+:/g) || []).length, 0),
      drawing_text_items: drawingRows.length,
      image_occurrences: imageRows.length,
      checkpoints: checkpoints.length,
      checkpoints_requiring_review: checkpoints.filter((checkpoint) => checkpoint.review_required).length,
    },
  };
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(standard, null, 2));
  return standard;
}

async function processSheet(sheetName, workbook, imagesBySheet, drawingsBySheet) {
  const sheet = workbook.Sheets[sheetName];
  const cells = sheetCells(sheet);
  const rawImageRows = imagesBySheet[sheetName] || [];
  const seenImageHashes = new Set();
  const imageRows = rawImageRows.filter((image) => {
    const filePath = path.join(RAG_ROOT, image.extracted_file);
    if (!fs.existsSync(filePath)) return true;
    const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    if (seenImageHashes.has(hash)) return false;
    seenImageHashes.add(hash);
    return true;
  });
  const drawingRows = drawingsBySheet[sheetName] || [];
  console.log(`[${sheetName}] ${cells.length} populated rows, ${imageRows.length} unique images (${rawImageRows.length - imageRows.length} exact duplicates removed), ${drawingRows.length} drawing labels`);
  if (DRY_RUN) return { sheetName, cells: cells.length, images: imageRows.length, drawingText: drawingRows.length };

  const imageAnalyses = [];
  for (let index = 0; index < imageRows.length; index += IMAGE_BATCH_SIZE) {
    const batch = imageRows.slice(index, index + IMAGE_BATCH_SIZE);
    const result = await analyzeImageBatch(sheetName, batch, Math.floor(index / IMAGE_BATCH_SIZE) + 1);
    imageAnalyses.push(...result.images);
  }
  const standard = await synthesizeSheet(sheetName, cells, drawingRows, imageRows, imageAnalyses);
  standard.title = displaySheetName(sheetName);
  standard.summary = "";
  standard.reference_notes = [];
  standard.quality_notes = [];
  const referenceTables = extractReferenceTables(sheetName, sheet);
  standard.reference_tables = referenceTables;
  if (referenceTables.length > 0) {
    standard.checkpoints = [];
    standard.reference_notes = [];
    standard.quality_notes = [];
    standard.evidence_counts.checkpoints = 0;
    standard.evidence_counts.checkpoints_requiring_review = 0;
  }
  return standard;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const workbook = XLSX.readFile(WORKBOOK_PATH);
  const imageRows = readCsv(IMAGE_INDEX_PATH);
  const drawingRows = readCsv(DRAWING_TEXT_PATH);
  const imagesBySheet = groupBy(imageRows, "source_sheet");
  const drawingsBySheet = groupBy(drawingRows, "source_sheet");
  const sheetNames = workbook.SheetNames.filter((name) => !SHEET_FILTER || name.toLowerCase() === SHEET_FILTER.toLowerCase());
  if (SHEET_FILTER && sheetNames.length === 0) throw new Error(`Sheet not found: ${SHEET_FILTER}`);

  console.log(`Accessory tooling extraction: ${sheetNames.length} sheets, ${imageRows.length} source image occurrences, model=${MODEL}, image_reasoning=${IMAGE_REASONING_EFFORT}, synthesis_reasoning=${SYNTHESIS_REASONING_EFFORT}, concurrency=${CONCURRENCY}, detail=${IMAGE_DETAIL}${DRY_RUN ? " (dry run)" : ""}`);
  const standards = await mapLimit(sheetNames, CONCURRENCY, (sheetName) => processSheet(sheetName, workbook, imagesBySheet, drawingsBySheet));
  if (DRY_RUN) { console.log(JSON.stringify(standards, null, 2)); return; }

  const database = {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    source_workbook: path.basename(WORKBOOK_PATH),
    model: MODEL,
    sheet_count: standards.length,
    image_occurrence_count: standards.reduce((sum, standard) => sum + standard.images.length, 0),
    standards,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(repairDeep(database), null, 2));
  console.log(`Wrote ${standards.length} standards to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
