import * as XLSX from "xlsx";
import type { ProjectMetadata, ToolRow } from "../types/project";
import type { FmeaDraftRow } from "../types/fmea";
import { countChecklistSources } from "../utils/checklistSources";

// ─── CSV Export ──────────────────────────────────────────────────────────────

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const FMEA_CSV_HEADERS = [
  "No.",
  "Tool No.",
  "Part Description",
  "Process Step",
  "Potential Failure Mode",
  "Potential Effect",
  "Severity",
  "Potential Cause",
  "Occurrence",
  "Prevention Control",
  "Detection Control",
  "Detection",
  "RPN",
  "Recommended Action",
  "Responsible",
  "Target Date",
  "Checklist Summary",
];

function fmeaToRow(item: FmeaDraftRow, index: number): (string | number)[] {
  const sourceCounts = item.checklistEntries?.length
    ? countChecklistSources(item.checklistEntries)
    : null;
  const checklistSummary = sourceCounts
    ? [
        sourceCounts.historical_fmea
          ? `${sourceCounts.historical_fmea} Previous FMEA`
          : "",
        sourceCounts.product_standard
          ? `${sourceCounts.product_standard} MEC Product Standard`
          : "",
        sourceCounts.baseline_standard
          ? `${sourceCounts.baseline_standard} Baseline Tooling Standard`
          : "",
      ].filter(Boolean).join("; ")
    : "No checklist data";
  
  return [
    index + 1,
    item.toolNo,
    item.partDescription,
    item.processStep,
    item.potentialFailureMode,
    item.potentialEffect,
    item.severity,
    item.potentialCause,
    item.occurrence,
    item.currentPreventionControl,
    item.currentDetectionControl,
    item.detection,
    item.rpn,
    item.recommendedAction,
    item.responsibleFunction,
    item.targetDate,
    checklistSummary,
  ];
}

export function exportCsv(
  fmeaRows: FmeaDraftRow[],
  metadata: ProjectMetadata,
): void {
  const dataRows = fmeaRows.map((r, i) => fmeaToRow(r, i));
  const csv = [FMEA_CSV_HEADERS, ...dataRows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");

  downloadBlob(
    csv,
    "text/csv;charset=utf-8",
    `${metadata.projectName || "fmea"}-ai-draft.csv`,
  );
}

// ─── JSON Export ─────────────────────────────────────────────────────────────

export function exportJson(
  fmeaRows: FmeaDraftRow[],
  metadata: ProjectMetadata,
  toolRows: ToolRow[],
): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    projectMetadata: metadata,
    toolRows: toolRows.map((r) => ({
      id: r.id,
      toolNo: r.toolNo,
      toolDescription: r.toolDescription,
      material: r.material,
      moldMaterial: r.moldMaterial,
      gateType: r.gateType,
      cavity: r.cavity,
      partWeight: r.partWeight,
      machineTonnage: r.machineTonnage,
      slides: r.slides,
      className: r.className,
      sourceSheet: r.sourceSheet,
      sourceRowNumber: r.sourceRowNumber,
      imageCount: r.images.length,
      draftStatus: r.draftStatus,
    })),
    fmeaDraftRows: fmeaRows,
    summary: {
      totalFmeaRows: fmeaRows.length,
      withChecklist: fmeaRows.filter((r) => r.checklistEntries && r.checklistEntries.length > 0).length,
      averageRpn: fmeaRows.length > 0 
        ? Math.round(fmeaRows.reduce((sum, r) => sum + r.rpn, 0) / fmeaRows.length)
        : 0,
    },
  };

  const json = JSON.stringify(payload, null, 2);
  downloadBlob(
    json,
    "application/json",
    `${metadata.projectName || "fmea"}-ai-draft.json`,
  );
}

// ─── Excel Export ────────────────────────────────────────────────────────────

export function exportExcel(
  fmeaRows: FmeaDraftRow[],
  metadata: ProjectMetadata,
  toolRows: ToolRow[],
): void {
  const wb = XLSX.utils.book_new();

  // ── Project Info sheet ──
  const infoData = [
    ["AI FMEA Draft Report"],
    [""],
    ["Project Name", metadata.projectName],
    ["Source File", metadata.sourceFilename],
    ["Tool Maker", metadata.toolMaker],
    ["Vendor", metadata.vendor],
    ["Quote Type", metadata.quoteType],
    ["Toy Year", metadata.toyYear],
    ["Revision", metadata.revision],
    ["Tool Plan", metadata.toolPlan],
    ["Set Count", metadata.setCount],
    ["Lead Time (days)", metadata.leadTimeDays ?? ""],
    ["Export Date", new Date().toISOString()],
    ["Total Tool Rows", toolRows.length],
    ["Total FMEA Rows", fmeaRows.length],
  ];
  const infoSheet = XLSX.utils.aoa_to_sheet(infoData);
  XLSX.utils.book_append_sheet(wb, infoSheet, "Project Info");

  // ── FMEA Draft sheet ──
  const fmeaData = [FMEA_CSV_HEADERS, ...fmeaRows.map((r, i) => fmeaToRow(r, i))];
  const fmeaSheet = XLSX.utils.aoa_to_sheet(fmeaData);

  // Set column widths
  fmeaSheet["!cols"] = FMEA_CSV_HEADERS.map((_, i) => ({
    wch: i <= 1 ? 14 : i <= 5 ? 30 : i <= 12 ? 12 : 30,
  }));

  XLSX.utils.book_append_sheet(wb, fmeaSheet, "FMEA Draft");

  // ── Tool Rows sheet ──
  const toolHeaders = [
    "Tool No.", "Part Description", "Material", "Mold Material", "Gate Type",
    "Cavity", "Part Weight", "Tool Aid", "Tool Build", "L", "W", "H", "THK",
    "Slides", "Color", "Machine Tonnage", "Class", "Source Sheet", "Source Row",
    "Images", "Draft Status",
  ];
  const toolData = [
    toolHeaders,
    ...toolRows.map((r) => [
      r.toolNo, r.toolDescription, r.material, r.moldMaterial, r.gateType,
      r.cavity, r.partWeight, r.toolAid, r.toolBuild, r.length, r.width,
      r.height, r.thickness, r.slides, r.color, r.machineTonnage, r.className,
      r.sourceSheet, r.sourceRowNumber, r.images.length, r.draftStatus,
    ]),
  ];
  const toolSheet = XLSX.utils.aoa_to_sheet(toolData);
  XLSX.utils.book_append_sheet(wb, toolSheet, "Tool Rows");

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    buffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `${metadata.projectName || "fmea"}-ai-draft.xlsx`,
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function downloadBlob(
  data: string | ArrayBuffer,
  mimeType: string,
  filename: string,
): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Copy FMEA rows as tab-separated text to clipboard.
 */
export async function copyFmeaToClipboard(fmeaRows: FmeaDraftRow[]): Promise<void> {
  const tsv = [FMEA_CSV_HEADERS, ...fmeaRows.map((r, i) => fmeaToRow(r, i))]
    .map((row) => row.join("\t"))
    .join("\n");
  await navigator.clipboard.writeText(tsv);
}
