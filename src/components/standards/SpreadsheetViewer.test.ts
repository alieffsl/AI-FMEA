import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx-js-style";
import { buildGrid, pickDefaultSheet, SPREADSHEET_EXTENSIONS } from "./SpreadsheetViewer";

/** A real MEC standard, so the test covers the files the viewer actually opens. */
const SAMPLE = resolve(process.cwd(), "public/MEC/bag.xlsm");

function readSample() {
  return XLSX.read(new Uint8Array(readFileSync(SAMPLE)), {
    type: "array",
    cellStyles: true,
  });
}

describe("SpreadsheetViewer", () => {
  it("claims the workbook extensions the download prompt used to catch", () => {
    expect(SPREADSHEET_EXTENSIONS).toContain("xlsm");
    expect(SPREADSHEET_EXTENSIONS).toContain("xls");
    expect(SPREADSHEET_EXTENSIONS).not.toContain("pptx");
  });

  it("parses a real .xlsm into a non-empty grid", () => {
    const wb = readSample();
    expect(wb.SheetNames.length).toBeGreaterThan(0);

    const grid = buildGrid(wb, wb.SheetNames[0], 300);
    expect(grid.rows.length).toBeGreaterThan(0);
    expect(grid.totalRows).toBeGreaterThan(0);

    const text = grid.rows.flat().map((cell) => cell.text).join(" ").trim();
    expect(text.length).toBeGreaterThan(0);
  });

  it("gives every rendered row a consistent column count once spans are counted", () => {
    const wb = readSample();
    const grid = buildGrid(wb, wb.SheetNames[0], 300);

    // A row's cells plus the rows spanning into it must never exceed the width.
    const width = grid.colWidths.length;
    for (const row of grid.rows) {
      const spanned = row.reduce((n, cell) => n + cell.colSpan, 0);
      expect(spanned).toBeLessThanOrEqual(width);
    }
  });

  it("honours the row limit and reports the true total", () => {
    const wb = readSample();
    const full = buildGrid(wb, wb.SheetNames[0], 100_000);
    const capped = buildGrid(wb, wb.SheetNames[0], 5);

    expect(capped.rows.length).toBeLessThanOrEqual(5);
    expect(capped.totalRows).toBe(full.totalRows);
  });

  it("trims the phantom empty range some workbooks declare", () => {
    const wb = readSample();
    const ws = wb.Sheets[wb.SheetNames[0]];
    const declared = XLSX.utils.decode_range(ws["!ref"] as string);
    const grid = buildGrid(wb, wb.SheetNames[0], 100_000);

    // Never renders more rows or columns than the sheet declares.
    expect(grid.totalRows).toBeLessThanOrEqual(declared.e.r - declared.s.r + 1);
    expect(grid.colWidths.length).toBeLessThanOrEqual(declared.e.c - declared.s.c + 1);
  });

  it("returns an empty grid for a sheet with no cells", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, {}, "Blank");
    const grid = buildGrid(wb, "Blank", 300);

    expect(grid.rows).toEqual([]);
    expect(grid.totalRows).toBe(0);
  });

  it("skips the near-empty Home nav sheet MEC workbooks open on", () => {
    const wb = readSample();
    expect(wb.SheetNames[0]).toBe("Home");
    // Home holds only nav labels; the guidance is on the next sheet.
    expect(pickDefaultSheet(wb)).toBe("General Concern");

    const grid = buildGrid(wb, pickDefaultSheet(wb)!, 300);
    expect(grid.filledCount).toBeGreaterThan(5);
  });

  it("falls back to the first sheet when nothing has much content", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Only"]]), "First");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Also"]]), "Second");
    expect(pickDefaultSheet(wb)).toBe("First");
  });

  it("expands merged anchors and drops the cells they cover", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Merged", "", "C1"],
      ["A2", "B2", "C2"],
    ]);
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    XLSX.utils.book_append_sheet(wb, ws, "Merges");

    const grid = buildGrid(wb, "Merges", 300);
    expect(grid.rows[0]).toHaveLength(2);
    expect(grid.rows[0][0]).toMatchObject({ text: "Merged", colSpan: 2 });
    expect(grid.rows[1]).toHaveLength(3);
  });
});
