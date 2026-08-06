import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx-js-style";
import type { FmeaDraftRow } from "../types/fmea";
import { exportFmeaToExcel } from "./excelExport";

type Entry = NonNullable<FmeaDraftRow["checklistEntries"]>[number];

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    tool_description_normalized: "Necklace",
    tool_category: null,
    failure_mode: "Scratch",
    sub_concern_index: 0,
    concern: "Surface scratched during ejection.",
    recommendation: "Polish ejector face to SPI A2.",
    supporting_record_count: 3,
    supporting_record_ids: [],
    supporting_failure_ids: [],
    similarity: 0.82,
    ...overrides,
  };
}

function draftRow(overrides: Partial<FmeaDraftRow> = {}): FmeaDraftRow {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    toolRowId: "t-1",
    toolNo: "JTX28-U831-01",
    partDescription: "Necklace",
    processStep: "Injection Molding",
    potentialFailureMode: "Scratch",
    potentialEffect: "Cosmetic reject",
    severity: 6,
    potentialCause: "Ejector drag",
    occurrence: 4,
    currentPreventionControl: "Tool polish",
    currentDetectionControl: "Visual check",
    detection: 3,
    rpn: 72,
    recommendedAction: "Polish",
    responsibleFunction: "Tooling",
    targetDate: "",
    hasEvidence: true,
    checklistEntries: [entry()],
    ...overrides,
  };
}

/** Runs the exporter in an empty cwd and reads back the workbook it wrote. */
function exportAndRead(rows: FmeaDraftRow[]) {
  const previousCwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "fmea-export-"));
  try {
    process.chdir(dir);
    exportFmeaToExcel(rows);
    const [filename] = readdirSync(dir);
    expect(filename).toMatch(/^FMEA_Draft_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);
    return XLSX.readFile(join(dir, filename), { cellStyles: true });
  } finally {
    process.chdir(previousCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Excel rejects a workbook whose merge ranges overlap. */
function findOverlappingMerges(merges: XLSX.Range[]) {
  const seen = new Map<string, XLSX.Range>();
  const clashes: Array<[XLSX.Range, XLSX.Range]> = [];
  for (const range of merges) {
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const key = `${r}:${c}`;
        const existing = seen.get(key);
        if (existing) clashes.push([existing, range]);
        else seen.set(key, range);
      }
    }
  }
  return clashes;
}

afterEach(() => {
  // exportAndRead restores cwd itself; this guards an early throw.
  expect(typeof process.cwd()).toBe("string");
});

describe("exportFmeaToExcel", () => {
  it("writes a detail sheet and a summary sheet", () => {
    const wb = exportAndRead([draftRow()]);
    expect(wb.SheetNames).toEqual(["FMEA Draft", "Summary"]);
  });

  it("merges tool, mode and S/O/D/RPN cells without overlapping", () => {
    const wb = exportAndRead([
      draftRow({ potentialFailureMode: "Scratch", checklistEntries: [entry(), entry(), entry()] }),
      draftRow({ potentialFailureMode: "Flash", rpn: 120, checklistEntries: [entry(), entry()] }),
    ]);
    const ws = wb.Sheets["FMEA Draft"];
    const merges = ws["!merges"] as XLSX.Range[];

    expect(findOverlappingMerges(merges)).toEqual([]);

    // Both modes belong to one tool: Tool No (col 0) spans all five entry rows.
    const toolMerge = merges.find((m) => m.s.c === 0 && m.s.r >= 4);
    expect(toolMerge).toEqual({ s: { r: 4, c: 0 }, e: { r: 8, c: 0 } });

    // Failure Mode (col 2) spans only its own entries: 3 rows, then 2.
    const modeMerges = merges.filter((m) => m.s.c === 2 && m.s.r >= 4);
    expect(modeMerges).toEqual([
      { s: { r: 4, c: 2 }, e: { r: 6, c: 2 } },
      { s: { r: 7, c: 2 }, e: { r: 8, c: 2 } },
    ]);

    // RPN (col 13) merges over the same span as its failure mode.
    const rpnMerges = merges.filter((m) => m.s.c === 13);
    expect(rpnMerges).toEqual([
      { s: { r: 4, c: 13 }, e: { r: 6, c: 13 } },
      { s: { r: 7, c: 13 }, e: { r: 8, c: 13 } },
    ]);
  });

  it("states each merged value once, on the anchor row", () => {
    const wb = exportAndRead([draftRow({ checklistEntries: [entry(), entry()] })]);
    const ws = wb.Sheets["FMEA Draft"];

    expect(ws.A5.v).toBe("JTX28-U831-01");
    expect(ws.A6.v).toBe("");
    expect(ws.C5.v).toBe("Scratch");
    expect(ws.C6.v).toBe("");
    expect(ws.N5.v).toBe(72);
    expect(ws.N6.v).toBe("");
    // Entry-scoped columns repeat per row.
    expect(ws.G5.v).toBe("Surface scratched during ejection.");
    expect(ws.G6.v).toBe("Surface scratched during ejection.");
  });

  it("keeps the header row and its autofilter aligned", () => {
    const wb = exportAndRead([draftRow()]);
    const ws = wb.Sheets["FMEA Draft"];
    expect(ws.A4.v).toBe("Tool No");
    expect(ws.N4.v).toBe("RPN");
    expect((ws["!autofilter"] as { ref: string }).ref).toBe("A4:N5");
  });

  it("stores similarity as a percent-formatted fraction", () => {
    const wb = exportAndRead([draftRow({ checklistEntries: [entry({ similarity: 0.82 })] })]);
    const ws = wb.Sheets["FMEA Draft"];
    expect(ws.J5.v).toBe(0.82);
    expect(ws.J5.z).toBe("0%");
  });

  it("orders tools by failure mode count, heaviest first", () => {
    const wb = exportAndRead([
      draftRow({ toolNo: "SMALL-01", partDescription: "Handbag" }),
      draftRow({ toolNo: "BIG-01", partDescription: "Torso", potentialFailureMode: "Flash" }),
      draftRow({ toolNo: "BIG-01", partDescription: "Torso", potentialFailureMode: "Sink" }),
    ]);
    const summary = wb.Sheets["Summary"];
    expect(summary.B2.v).toBe("BIG-01");
    expect(summary.D2.v).toBe(2);
    expect(summary.B3.v).toBe("SMALL-01");
    expect(summary.D3.v).toBe(1);
  });

  it("renders a no-evidence tool as a single placeholder line", () => {
    const wb = exportAndRead([
      draftRow({
        toolNo: "NOEV-01",
        partDescription: "Gel Face Mask",
        potentialFailureMode: "No historical data",
        hasEvidence: false,
        checklistEntries: [],
        rpn: 0,
      }),
    ]);
    const ws = wb.Sheets["FMEA Draft"];
    expect(ws.C5.v).toBe("No historical data");
    expect(ws.D5.v).toBe("No matched evidence");
    expect(ws.G5.v).toBe("No historical evidence matched this tool.");
    expect(ws.J5.v).toBe("");
    expect(wb.Sheets["Summary"].H2.v).toBe("No historical data");
  });
});
