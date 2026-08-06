import * as XLSX from "xlsx-js-style";
import type { CdiParseResult, ProjectMetadata, ToolRow } from "../types/project";
import { normalizeToolDescription } from "../utils/normalizeToolDescription";

// ─── Column name normalization map ───────────────────────────────────────────

const COLUMN_ALIASES: Record<string, string[]> = {
  toolNo: ["tool no", "tool number", "mold no", "tool id"],
  toolDescription: ["tool description", "part description", "description", "part name", "tool desc", "part desc", "mold description"],
  partWeight: ["part weight", "part wt", "weight", "part weight (g)", "wt(g)", "wt (g)", "part wt(g)"],
  material: ["material", "resin", "resin mat", "resin mat'l", "resin material", "mat'l", "matl"],
  moldMaterial: ["mold material", "insert mat'l", "insert material", "mold mat'l", "steel", "insert mat", "mold steel"],
  gateType: ["gate type", "gating", "gate", "gate style", "runner type"],
  cavity: ["cavity", "cav", "cav.", "cavities", "no of cav"],
  cycleTimeSec: ["cycle time", "cycle time (s)", "cycle (s)", "cycle sec", "ct(s)", "ct (s)", "cycle time sec"],
  weeklyCapacity: ["weekly cap", "weekly capacity", "weekly cap k", "wk cap", "cap/wk"],
  toolAid: ["tool aid", "toolaid", "aid"],
  toolBuild: ["tool build", "toolbuild", "build", "tool builder"],
  length: ["l", "length", "l (inch)", "l(inch)", "size l"],
  width: ["w", "width", "w (inch)", "w(inch)", "size w"],
  height: ["h", "height", "h (inch)", "h(inch)", "size h"],
  thickness: ["thk", "thickness", "t", "th", "thk (inch)", "thk(inch)", "size thk", "size th"],
  slides: ["slides", "slide", "no slides", "no of slides", "number of slides", "slide count", "of slides", "of slide"],
  color: ["color", "colour", "col", "colors", "colours"],
  machineTonnage: ["machine tonnage", "m/c ton", "mc ton", "tonnage", "machine ton", "press ton", "m/c tonnage", "m cton", "mcton", "m c ton", "m c"],
  className: ["class", "tool class", "mold class", "cls"],
  refPartNumber: ["ref part", "ref part no", "ref part number", "part no", "part number", "ref no"],
  decoration: ["decoration", "deco", "surface", "finish", "paint", "tampo"],
  assembly: ["assembly", "assy", "assembly note", "assy note"],
  qtyPerToy: ["qty/toy", "qty per toy", "qty", "quantity"],
};

// ─── Metadata field aliases ──────────────────────────────────────────────────

const META_ALIASES: Record<keyof ProjectMetadata, string[]> = {
  projectName: ["project", "project name", "style name", "toy name", "product name", "style", "item", "product", "item name"],
  sourceFilename: [],
  toolMaker: ["tool maker", "toolmaker", "mold maker", "moldmaker", "tool vendor", "maker", "tool maker name", "mold vendor"],
  vendor: ["vendor", "manufacturing vendor", "mfg vendor", "factory", "supplier", "mfg vendor name", "vendor name", "manufacturing site", "factory name", "mfg site", "mfg factory", "plant", "assigned manufacturing vendor", "assigned maufacturing vendor"],
  quoteType: ["quote type", "quotetype", "quote", "type", "tool type", "mold type"],
  toyYear: ["toy year", "year", "toyyear", "fy", "fiscal year", "toy yr", "model year", "yr", "fy year", "toy no", "toy no.", "style no", "style no."],
  revision: ["revision", "rev", "rev.", "version", "rev no", "revision no", "rev no"],
  toolPlan: ["tool plan", "toolplan", "total molds", "mold plan", "# molds", "total tools", "no of molds", "mold qty"],
  setCount: ["set count", "sets", "set", "# sets", "no of sets"],
  leadTimeDays: ["lead time", "leadtime", "lead time days", "lt days", "lt (days)", "tooling lead time", "lt", "tooling lt", "lead time days", "tool lead time", "lt day", "lead time wk", "leadtime days"],
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function normalizeHeader(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/#/g, " no ")
    .replace(/[_/]+/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/[().']+/g, "")
    .replace(/\s+/g, " ");
}

function matchColumn(header: string): string | null {
  const normalized = normalizeHeader(header);
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((alias) => {
      const normAlias = normalizeHeader(alias);
      return normalized === normAlias || normalized.startsWith(normAlias + " ");
    })) {
      return canonical;
    }
  }
  return null;
}

function matchMetaKey(label: string): keyof ProjectMetadata | null {
  const normalized = normalizeHeader(label);
  for (const [key, aliases] of Object.entries(META_ALIASES)) {
    if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      return key as keyof ProjectMetadata;
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

let nextId = 1;
function makeId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

// ─── Header detection ────────────────────────────────────────────────────────

function detectHeaderRow(sheet: XLSX.WorkSheet): { headerRow: number; columnMap: Record<string, number> } | null {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const maxScan = Math.min(range.e.r, 30); // scan first 30 rows

  for (let r = range.s.r; r <= maxScan; r++) {
    const columnMap: Record<string, number> = {};
    let matchCount = 0;

    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || !cell.v) continue;

      const matched = matchColumn(String(cell.v));
      if (matched && !columnMap[matched]) {
        columnMap[matched] = c;
        matchCount++;
      }
    }

    // require at least 3 matched columns to consider this a header row
    if (matchCount >= 3) {
      // Also scan up to 2 rows below for sub-headers (like L, W, H, THK under SIZE)
      const maxSubR = Math.min(r + 2, range.e.r);
      for (let subR = r + 1; subR <= maxSubR; subR++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const nextCell = sheet[XLSX.utils.encode_cell({ r: subR, c })];
          if (!nextCell || !nextCell.v) continue;
          
          const matched = matchColumn(String(nextCell.v));
          // Don't overwrite if the main header row already matched it
          if (matched && !columnMap[matched]) {
            columnMap[matched] = c;
          }
        }
      }
      return { headerRow: r, columnMap };
    }
  }

  return null;
}

// ─── Metadata extraction ─────────────────────────────────────────────────────

function extractMetadata(sheet: XLSX.WorkSheet, headerRow: number, filename: string): { metadata: ProjectMetadata; warnings: string[] } {
  const warnings: string[] = [];
  const metadata: ProjectMetadata = {
    projectName: "",
    sourceFilename: filename,
    toolMaker: "",
    vendor: "",
    quoteType: "",
    toyYear: "",
    revision: "",
    toolPlan: "",
    setCount: "",
    leadTimeDays: null,
  };

  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const scanEnd = Math.min(headerRow, 20);

  for (let r = range.s.r; r < scanEnd; r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 25); c++) {
      const labelCell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!labelCell || !labelCell.v) continue;

      const cellText = String(labelCell.v).trim();

      // Try same-cell colon/equals split (e.g., "Vendor: PTMI" or "Rev = 2")
      const colonSplit = cellText.split(/[:=]\s*/);
      if (colonSplit.length >= 2) {
        const labelPart = colonSplit[0].trim();
        const valuePart = colonSplit.slice(1).join(":").trim();
        const metaKeyFromColon = matchMetaKey(labelPart);
        if (metaKeyFromColon && valuePart) {
          if (metaKeyFromColon === "leadTimeDays") {
            const numVal = toNumber(valuePart);
            if (numVal !== null) metadata.leadTimeDays = numVal;
          } else if (!(metadata as Record<string, unknown>)[metaKeyFromColon]) {
            (metadata as Record<string, unknown>)[metaKeyFromColon] = valuePart;
          }
          continue;
        }
      }

      const metaKey = matchMetaKey(cellText);
      if (!metaKey) continue;

      // Already found this field — skip to avoid overwrite
      if (metaKey !== "leadTimeDays" && (metadata as Record<string, unknown>)[metaKey]) continue;
      if (metaKey === "leadTimeDays" && metadata.leadTimeDays !== null) continue;

      // Try cells to the right (up to 5 columns away)
      for (let offset = 1; offset <= 5; offset++) {
        const valueCell = sheet[XLSX.utils.encode_cell({ r, c: c + offset })];
        if (valueCell && valueCell.v !== undefined && String(valueCell.v).trim() !== "") {
          if (metaKey === "leadTimeDays") {
            const numVal = toNumber(valueCell.v);
            if (numVal !== null) {
              metadata.leadTimeDays = numVal;
              break;
            }
          } else {
            (metadata as Record<string, unknown>)[metaKey] = toString(valueCell.v);
            break;
          }
        }
      }

      // If not found to the right, try the cell directly below the label
      if (metaKey === "leadTimeDays" && metadata.leadTimeDays === null) {
        const belowCell = sheet[XLSX.utils.encode_cell({ r: r + 1, c })];
        if (belowCell && belowCell.v !== undefined && String(belowCell.v).trim() !== "") {
          metadata.leadTimeDays = toNumber(belowCell.v);
        }
      } else if (!(metadata as Record<string, unknown>)[metaKey]) {
        const belowCell = sheet[XLSX.utils.encode_cell({ r: r + 1, c })];
        if (belowCell && belowCell.v !== undefined && String(belowCell.v).trim() !== "") {
          (metadata as Record<string, unknown>)[metaKey] = toString(belowCell.v);
        }
      }
    }
  }

  if (!metadata.projectName) {
    warnings.push("Could not detect project name from the CDI header area.");
  }

  // Log extracted metadata for debugging
  console.info('[CDI Parser] Extracted metadata:', metadata);

  return { metadata, warnings };
}

// ─── Row parsing ─────────────────────────────────────────────────────────────

function parseToolRows(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  headerRow: number,
  columnMap: Record<string, number>,
): { rows: ToolRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const rows: ToolRow[] = [];
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    // Check if we hit the "Existing Tool/Part" section divider
    let isExistingSection = false;
    for (let c = range.s.c; c <= Math.min(range.e.c, 15); c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v && typeof cell.v === "string") {
        if (/existing\s*(tool|part|mold)/i.test(cell.v)) {
          isExistingSection = true;
          break;
        }
      }
    }
    if (isExistingSection) {
      break; // Stop parsing rows once we reach the existing tools section
    }

    // Build raw row data
    const rawRowData: Record<string, unknown> = {};
    let hasAnyValue = false;

    for (const [field, col] of Object.entries(columnMap)) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: col })];
      const value = cell?.v ?? null;
      rawRowData[field] = value;
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        hasAnyValue = true;
      }
    }

    if (!hasAnyValue) continue; // skip empty rows

    const toolNo = toString(rawRowData.toolNo);
    const toolDescription = toString(rawRowData.toolDescription);
    const normalizedToolDescription = normalizeToolDescription(toolDescription);

    // skip rows without a tool no
    if (!toolNo) continue;

    rows.push({
      id: makeId("cdi"),
      sourceSheet: sheetName,
      sourceRowNumber: r + 1, // 1-indexed for display
      toolNo,
      rawToolDescription: toolDescription, // sent to the API; normalized there exactly once
      toolDescription: normalizedToolDescription, // display/grouping only
      partDescription: normalizedToolDescription, // alias - also normalized
      partWeight: toNumber(rawRowData.partWeight),
      material: toString(rawRowData.material),
      moldMaterial: toString(rawRowData.moldMaterial),
      gateType: toString(rawRowData.gateType),
      cavity: toNumber(rawRowData.cavity),
      cycleTimeSec: toNumber(rawRowData.cycleTimeSec),
      weeklyCapacity: toNumber(rawRowData.weeklyCapacity),
      toolAid: toString(rawRowData.toolAid),
      toolBuild: toString(rawRowData.toolBuild),
      length: toNumber(rawRowData.length),
      width: toNumber(rawRowData.width),
      height: toNumber(rawRowData.height),
      thickness: toNumber(rawRowData.thickness),
      slides: toNumber(rawRowData.slides),
      color: toString(rawRowData.color),
      machineTonnage: toNumber(rawRowData.machineTonnage),
      className: toString(rawRowData.className),
      refPartNumber: toString(rawRowData.refPartNumber),
      decoration: toString(rawRowData.decoration),
      assembly: toString(rawRowData.assembly),
      rawRowData,
      images: [],
      draftStatus: "pending",
      selected: true,
    });
  }

  if (rows.length === 0) {
    warnings.push(`No tool rows found in sheet "${sheetName}".`);
  }

  return { rows, warnings };
}

// ─── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse a CDI Excel file (.xlsx or .xlsm) and extract project metadata and tool rows.
 */
export async function parseCdiFile(file: File): Promise<CdiParseResult> {
  const validTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
  ];
  const validExtensions = [".xlsx", ".xlsm"];
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

  if (!validTypes.includes(file.type) && !validExtensions.includes(ext)) {
    throw new Error(`Invalid file type. Expected .xlsx or .xlsm, got "${ext}".`);
  }

  nextId = 1; // reset for each parse

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellStyles: false });

  if (!workbook.SheetNames.length) {
    throw new Error("The uploaded Excel file contains no sheets.");
  }

  const allWarnings: string[] = [];
  const allRows: ToolRow[] = [];
  let metadata: ProjectMetadata | null = null;

  const isToolPlanSheet = (sheetName: string) =>
    sheetName.toUpperCase().replace(/[_]/g, " ").replace(/\s+/g, " ").includes("TOOL PLAN");

  // Prefer sheets named "TOOL PLAN", but fall back to scanning every sheet so a
  // workbook using a different tab name still parses instead of failing with a
  // message about columns.
  const toolPlanSheets = workbook.SheetNames.filter(isToolPlanSheet);
  const sheetsToScan = toolPlanSheets.length > 0 ? toolPlanSheets : workbook.SheetNames;

  if (toolPlanSheets.length === 0) {
    allWarnings.push(
      `No sheet named "TOOL PLAN" was found. Scanned all ${workbook.SheetNames.length} sheet(s) instead.`,
    );
  }

  for (const sheetName of sheetsToScan) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) continue;

    const detected = detectHeaderRow(sheet);
    if (!detected) continue;

    const { headerRow, columnMap } = detected;

    if (!metadata) {
      const metaResult = extractMetadata(sheet, headerRow, file.name);
      metadata = metaResult.metadata;
      allWarnings.push(...metaResult.warnings);
    }

    const { rows, warnings } = parseToolRows(sheet, sheetName, headerRow, columnMap);
    allRows.push(...rows);
    allWarnings.push(...warnings);
  }

  if (!metadata) {
    metadata = {
      projectName: file.name.replace(/\.[^.]+$/, ""),
      sourceFilename: file.name,
      toolMaker: "",
      vendor: "",
      quoteType: "",
      toyYear: "",
      revision: "",
      toolPlan: "",
      setCount: "",
      leadTimeDays: null,
    };
    allWarnings.push("Could not detect structured metadata. Using filename as project name.");
  }

  if (allRows.length === 0) {
    throw new Error(
      "No tool rows could be parsed from the uploaded file. " +
      "Ensure a sheet has a header row containing at least three recognised columns " +
      "(for example Tool No., Part Description, Material) and that each tool row has a Tool No. " +
      `Sheets checked: ${sheetsToScan.join(", ") || "none"}.`
    );
  }

  // Derive toolPlan/setCount if not found
  if (!metadata.toolPlan) {
    const uniqueTools = new Set(allRows.map((r) => r.toolNo).filter(Boolean));
    metadata.toolPlan = `${uniqueTools.size} Tools`;
  }

  return {
    metadata,
    toolRows: allRows,
    warnings: allWarnings,
  };
}

/**
 * Convert demo/mock data into the new ToolRow format for backward compatibility.
 */
export function convertLegacyToolInput(
  input: {
    id: string;
    toolNo: string;
    toolDescription: string;
    material: string;
    moldMaterial: string;
    gateType: string;
    cavity: number;
    partWeightG: number;
    toolAid?: string;
    toolBuild?: string;
    sizeInch?: { l?: number; w?: number; h?: number; thk?: number };
    slideCount?: number;
    color?: string;
    machineTon?: number;
    toolClass?: string;
    refPartNumber?: string;
    decoration?: string;
    assembly?: string;
    cycleTimeSec?: number;
    weeklyCapacityToys?: number;
    cdiSource?: { workbook: string; sheet: string; row: number };
    projectCode?: string;
    projectName?: string;
  },
): ToolRow {
  return {
    id: input.id,
    sourceSheet: input.cdiSource?.sheet ?? "manual",
    sourceRowNumber: input.cdiSource?.row ?? 0,
    toolNo: input.toolNo,
    rawToolDescription: input.toolDescription,
    toolDescription: input.toolDescription,
    partDescription: input.toolDescription,
    partWeight: input.partWeightG,
    material: input.material,
    moldMaterial: input.moldMaterial,
    gateType: input.gateType,
    cavity: input.cavity,
    cycleTimeSec: input.cycleTimeSec ?? null,
    weeklyCapacity: input.weeklyCapacityToys ?? null,
    toolAid: input.toolAid ?? "",
    toolBuild: input.toolBuild ?? "",
    length: input.sizeInch?.l ?? null,
    width: input.sizeInch?.w ?? null,
    height: input.sizeInch?.h ?? null,
    thickness: input.sizeInch?.thk ?? null,
    slides: input.slideCount ?? null,
    color: input.color ?? "",
    machineTonnage: input.machineTon ?? null,
    className: input.toolClass ?? "",
    refPartNumber: input.refPartNumber ?? "",
    decoration: input.decoration ?? "",
    assembly: input.assembly ?? "",
    rawRowData: {},
    images: [],
    draftStatus: "pending",
    selected: true,
  };
}
