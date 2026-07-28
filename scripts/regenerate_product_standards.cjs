const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const unzipper = require("unzipper");
const { OpenAI } = require("openai");
require("dotenv").config({ path: path.join(__dirname, "../migration/.env") });

const ROOT = path.join(__dirname, "..");
const DATABASE_PATH = path.join(ROOT, "src/data/mec_product_standard_v2.json");
const SOURCE_MAPPING_PATH = path.join(ROOT, "src/data/sourceMapping.json");
const MASTER_WORKBOOK_PATH = path.join(ROOT, "Copy of MEC-Product-Standard-revision.xlsx");
const MEC_ROOT = path.join(ROOT, "public/MEC");
const IMAGE_ROOT = path.join(ROOT, "public/mec_images");
const MODEL = process.env.PRODUCT_STANDARDS_OPENAI_MODEL || "gpt-5.6-sol";
const REASONING_EFFORT = process.env.PRODUCT_STANDARDS_REASONING_EFFORT || "medium";
const TARGET_SLUGS = new Set(
  (process.env.PRODUCT_STANDARDS_SLUGS || "barbie-hand-design-guidelines,gear-clearance-guidelines")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const CLEANUP_ONLY = process.argv.includes("--cleanup-only");
// Source workbooks sometimes embed both a small preview and the original
// artwork. Keep the verified higher-resolution asset when both are present.
const SUPERSEDED_IMAGE_REFERENCES = new Map([
  ["belt.xlsm_image1.jpeg", "belt.xlsm_image6.png"],
  ["belt.xlsm_image2.jpeg", "belt.xlsm_image4.jpg"],
  ["belt.xlsm_image3.jpeg", "belt.xlsm_image8.jpg"],
  ["crown-tiara.xlsm_image1.jpeg", "crown-tiara.xlsm_image3.jpg"],
  ["headband.xlsm_image1.jpeg", "headband.xlsm_image4.jpg"],
  ["headband.xlsm_image2.jpeg", "headband.xlsm_image5.jpg"],
  ["bracelet.xlsm_image2.jpeg", "bracelet.xlsm_image3.jpg"],
  ["necklace.xlsm_image1.jpeg", "necklace.xlsm_image2.jpg"],
  ["doll stand.xlsm_image1.jpeg", "doll stand.xlsm_image3.jpg"],
  ["disney fashion.xlsm_image1.jpeg", "disney fashion.xlsm_image4.jpg"],
  ["girls-inc-earring.xlsm_image1.jpeg", "girls-inc-earring.xlsm_image3.jpeg"],
  ["battery-compartment.xlsm_image2.png", "battery-compartment.xlsm_image4.png"],
]);

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing from migration/.env");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const pageSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    page_type: { type: "string", enum: ["guideline_article", "technical_reference"] },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          image_references: { type: "array", items: { type: "string" } },
          type: { type: "string", enum: ["design_rule", "guideline", "goal", "reference"] },
        },
        required: ["title", "content", "image_references", "type"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "page_type", "sections"],
  additionalProperties: false,
};

function normalizeTitle(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function workbookSheetEvidence(sheetName) {
  const workbook = XLSX.readFile(MASTER_WORKBOOK_PATH);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Workbook sheet not found: ${sheetName}`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" })
    .map((row, rowIndex) =>
      row
        .map((value, columnIndex) => {
          const text = String(value).replace(/\s+/g, " ").trim();
          return text ? `${XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })}: ${text}` : "";
        })
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean)
    .join("\n");
}

function workbookFileEvidence(filePath) {
  const workbook = XLSX.readFile(filePath);
  return workbook.SheetNames.map((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });
    const text = rows
      .map((row) => row.map((value) => String(value).replace(/\s+/g, " ").trim()).filter(Boolean).join(" | "))
      .filter(Boolean)
      .join("\n");
    return `SHEET: ${sheetName}\n${text}`;
  }).join("\n\n");
}

async function imagesFromOfficeFile(filePath) {
  const images = [];
  const archive = await unzipper.Open.file(filePath);
  for (const entry of archive.files) {
    if (!entry.path.match(/(?:xl|ppt)\/media\/.*\.(png|jpe?g|gif|webp)$/i)) continue;
    const buffer = await entry.buffer();
    const extension = path.extname(entry.path).slice(1).toLowerCase();
    const mime = extension === "jpg" ? "jpeg" : extension;
    images.push({
      name: `${path.basename(filePath)}_${path.basename(entry.path)}`,
      dataUrl: `data:image/${mime};base64,${buffer.toString("base64")}`,
    });
  }
  return images;
}

function findFileByBasename(basename) {
  const stack = [MEC_ROOT];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.name.toLowerCase() === basename.toLowerCase()) return fullPath;
    }
  }
  return "";
}

async function sourceEvidence(page) {
  if (page.slug === "barbie-hand-design-guidelines") {
    return { text: workbookSheetEvidence("hand"), images: [], source: "Master workbook sheet: hand" };
  }
  if (page.slug === "gear-clearance-guidelines") {
    const filePath = findFileByBasename("Gear.xlsm");
    return {
      text: workbookFileEvidence(filePath),
      images: await imagesFromOfficeFile(filePath),
      source: path.basename(filePath),
    };
  }
  throw new Error(`No evidence adapter configured for ${page.slug}`);
}

async function regeneratePage(page) {
  const evidence = await sourceEvidence(page);
  const content = [{
    type: "input_text",
    text: [
      `Regenerate the Product Standards article "${page.title}" using only the supplied source evidence.`,
      "",
      "Success criteria:",
      "- Write all user-facing descriptions in concise, professional English.",
      "- Translate Chinese accurately; do not leave Chinese prose in the result.",
      "- Preserve every numeric value, unit, formula, qualifier, and engineering relationship exactly as supported.",
      "- Do not infer missing tolerances, acceptance criteria, or design rules.",
      "- Use real Markdown line breaks, never literal backslash-n text.",
      "- Merge repetitive sections and omit boilerplate, downloads, navigation text, and unrelated material.",
      "- Assign each useful image filename to at most one section. Omit decorative, unclear, or redundant images.",
      `- Only use image filenames from this allowed list: ${evidence.images.map((image) => image.name).join(", ") || "(none)"}.`,
      "",
      `SOURCE: ${evidence.source}`,
      evidence.text.slice(0, 50000),
      "",
      `CURRENT ARTICLE (use only as a hint; source evidence wins): ${JSON.stringify(page)}`,
    ].join("\n"),
  }];
  for (const image of evidence.images) {
    content.push({ type: "input_text", text: `IMAGE FILENAME: ${image.name}` });
    content.push({ type: "input_image", image_url: image.dataUrl, detail: "high" });
  }

  const response = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: REASONING_EFFORT },
    input: [
      {
        role: "developer",
        content: "You are a mechanical engineering standards editor. Source fidelity and auditability are more important than completeness.",
      },
      { role: "user", content },
    ],
    max_output_tokens: 6000,
    text: {
      format: {
        type: "json_schema",
        name: "product_standard_article",
        strict: true,
        schema: pageSchema,
      },
    },
  });
  if (response.status !== "completed" || !response.output_text) {
    throw new Error(`Incomplete OpenAI response for ${page.slug}: ${response.incomplete_details?.reason || response.status}`);
  }
  return { ...JSON.parse(response.output_text), slug: page.slug };
}

function sanitizePage(page) {
  const seenImages = new Set();
  const pageImageKeys = new Set(
    page.sections.flatMap((section) =>
      (section.image_references || []).map((reference) => reference.toLowerCase().trim())
    ),
  );
  const sections = page.sections
    .map((section) => {
      const references = [];
      for (let reference of section.image_references || []) {
        reference = reference.replace(
          /^Girls-Inc-hair-clip-V1\.xlsm_image1\.png$/i,
          "Girls-Inc-hair-clip -V1.xlsm_image1.png",
        );
        const key = reference.toLowerCase().trim();
        const replacement = SUPERSEDED_IMAGE_REFERENCES.get(key);
        if (replacement && pageImageKeys.has(replacement)) continue;
        if (!key || seenImages.has(key)) continue;
        const localPath = reference.startsWith("/") ? path.join(ROOT, "public", reference) : path.join(IMAGE_ROOT, reference);
        if (!fs.existsSync(localPath)) continue;
        seenImages.add(key);
        references.push(reference);
      }
      const normalizedContent = section.content.replace(/\\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      const lines = normalizedContent.split("\n");
      const tableStart = lines.findIndex((line, index) =>
        /^\s*\|.*\|\s*$/.test(line) &&
        /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1] || ""),
      );
      let table = section.table;
      let content = normalizedContent;
      if (tableStart >= 0) {
        const tableLines = lines.slice(tableStart).filter((line) => /^\s*\|.*\|\s*$/.test(line));
        const parseRow = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
        table = {
          columns: parseRow(tableLines[0]),
          rows: tableLines.slice(2).map(parseRow),
        };
        content = lines.slice(0, tableStart).join("\n").trim();
      }
      return {
        ...section,
        title: section.title.trim(),
        content,
        image_references: references,
        ...(table ? { table } : {}),
      };
    })
    .filter((section) => section.title && (section.content || section.image_references.length || section.table));
  return { ...page, title: page.title.trim(), sections };
}

function informationScore(page) {
  const uniqueImages = new Set(page.sections.flatMap((section) => section.image_references.map((item) => item.toLowerCase())));
  return page.sections.reduce((sum, section) => sum + section.title.length + section.content.length, 0) + uniqueImages.size * 100;
}

function deduplicatePages(pages) {
  const groups = new Map();
  for (const page of pages) {
    const key = normalizeTitle(page.title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(page);
  }
  return [...groups.values()].map((group) => {
    const canonicalSlug = group[0].slug.replace(/-\d+$/, "");
    const best = group.reduce((current, candidate) =>
      informationScore(candidate) > informationScore(current) ? candidate : current,
    );
    return { ...best, slug: canonicalSlug };
  });
}

function allMecFiles() {
  const files = [];
  const stack = [MEC_ROOT];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else files.push(fullPath);
    }
  }
  return files;
}

function preferredViewerSource(filePath, files) {
  const extension = path.extname(filePath).toLowerCase();
  if (![".ppt", ".pptx"].includes(extension)) return filePath;
  const stem = path.basename(filePath, extension).toLowerCase();
  return files.find((candidate) =>
    path.extname(candidate).toLowerCase() === ".pdf" &&
    path.basename(candidate, ".pdf").toLowerCase() === stem
  ) || filePath;
}

function buildSourceMapping(pages) {
  const files = allMecFiles();
  const byBasename = new Map(files.map((filePath) => [path.basename(filePath).toLowerCase(), filePath]));
  const manual = {
    "upper-arm-insert-molding": "Boy-Max-Steel-STD/2d-drawings/2013-ms-sdt-lt-upper-arm-ft.dwg",
    "lower-arm-insert-molding-guidelines": "Boy-Max-Steel-STD/2d-drawings/2013-ms-sdt-lt-lower-arm-ft.dwg",
    "barbie-hand-design-guidelines": "Data/General Guideline for hand.doc",
  };
  const internalWorkbookSlugs = new Set([
    "ken-doll-design-guidelines",
    "chelsea-doll-design-guidelines",
    "collector-doll-guidelines",
    "barbie-doll-design-guidelines",
    "barbie-general-concern",
    "barbie-neck-connector-design",
    "barbie-arm-design",
    "barbie-arm-tool-design",
    "upper-arm-insert-molding",
    "lower-arm-insert-molding-guidelines",
    "hand-insert-mold-guidelines",
    "lower-leg-insert-mold-guidelines",
    "barbie-hand-design-guidelines",
    "barbie-torso-design",
    "barbie-doll-mca-ptmi",
    "barbie-leg-plug-in-design",
  ]);
  const mapping = {};

  for (const page of pages) {
    if (manual[page.slug] && fs.existsSync(path.join(MEC_ROOT, manual[page.slug]))) {
      mapping[page.slug] = manual[page.slug];
      continue;
    }
    // These articles come from individual sheets in the master workbook.
    // Do not attach an unrelated external file merely because a section reuses one of its images.
    if (internalWorkbookSlugs.has(page.slug)) continue;
    const references = page.sections.flatMap((section) => section.image_references);
    let sourceFile = "";
    for (const reference of references) {
      if (reference.startsWith("/")) continue;
      const sourceBasename = reference.replace(/_image\d+\.(?:png|jpe?g|gif|webp)$/i, "");
      sourceFile = byBasename.get(sourceBasename.toLowerCase()) || byBasename.get(reference.toLowerCase()) || "";
      if (sourceFile) break;
    }
    if (!sourceFile) continue;
    sourceFile = preferredViewerSource(sourceFile, files);
    mapping[page.slug] = path.relative(MEC_ROOT, sourceFile).replace(/\\/g, "/");
  }
  return mapping;
}

async function main() {
  let pages = JSON.parse(fs.readFileSync(DATABASE_PATH, "utf8"));
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (CLEANUP_ONLY || !TARGET_SLUGS.has(page.slug)) continue;
    console.log(`Regenerating ${page.slug} with ${MODEL} (${REASONING_EFFORT} reasoning)...`);
    pages[index] = await regeneratePage(page);
  }

  pages = deduplicatePages(pages.map(sanitizePage));
  const sourceMapping = buildSourceMapping(pages);
  fs.writeFileSync(DATABASE_PATH, `${JSON.stringify(pages, null, 2)}\n`, "utf8");
  fs.writeFileSync(SOURCE_MAPPING_PATH, `${JSON.stringify(sourceMapping, null, 2)}\n`, "utf8");
  console.log(`Wrote ${pages.length} unique Product Standards pages and ${Object.keys(sourceMapping).length} verified source mappings.`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
