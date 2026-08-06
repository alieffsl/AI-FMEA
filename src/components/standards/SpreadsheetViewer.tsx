import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ImageOff } from "lucide-react";
import * as XLSX from "xlsx-js-style";

/**
 * Renders a workbook from public/MEC inline instead of forcing a download.
 *
 * `.xlsm` is ordinary OOXML with a macro part, so SheetJS parses it like any
 * `.xlsx`; legacy `.xls` is handled by the same reader. What SheetJS does not
 * expose is embedded pictures and the VBA project, hence the footer note and
 * the Download button the toolbar keeps.
 */

export const SPREADSHEET_EXTENSIONS = ["xlsx", "xlsm", "xlsb", "xls", "csv"];

/** Rows rendered before the "show everything" escape hatch. */
const INITIAL_ROW_LIMIT = 300;

type Grid = {
  sheetNames: string[];
  rows: RenderCell[][];
  totalRows: number;
  colWidths: number[];
  /** Cells carrying text — low counts mean the sheet is mostly pictures. */
  filledCount: number;
};

/**
 * MEC workbooks open on a "Home" sheet that is just a picture with a handful of
 * navigation labels, so landing there looks broken. Nav pages hold 2-5 label
 * cells; the guidance sheets hold more, so this threshold separates them.
 */
const NAV_SHEET_MAX_CELLS = 5;

function contentCellCount(ws: XLSX.WorkSheet | undefined): number {
  if (!ws) return 0;
  let count = 0;
  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue;
    const value = (ws[key] as XLSX.CellObject)?.v;
    if (value !== undefined && String(value).trim() !== "") count += 1;
  }
  return count;
}

/** First sheet with real content, falling back to the workbook's own first. */
export function pickDefaultSheet(workbook: XLSX.WorkBook): string | null {
  const withContent = workbook.SheetNames.find(
    (name) => contentCellCount(workbook.Sheets[name]) > NAV_SHEET_MAX_CELLS,
  );
  return withContent ?? workbook.SheetNames[0] ?? null;
}

type RenderCell = {
  key: string;
  text: string;
  numeric: boolean;
  rowSpan: number;
  colSpan: number;
  background?: string;
  ink?: string;
};

/** Cells covered by a merge are skipped; the anchor carries the span. */
function buildMergeIndex(merges: XLSX.Range[]) {
  const anchors = new Map<string, { rowSpan: number; colSpan: number }>();
  const covered = new Set<string>();

  for (const range of merges) {
    anchors.set(`${range.s.r}:${range.s.c}`, {
      rowSpan: range.e.r - range.s.r + 1,
      colSpan: range.e.c - range.s.c + 1,
    });
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (r !== range.s.r || c !== range.s.c) covered.add(`${r}:${c}`);
      }
    }
  }

  return { anchors, covered };
}

/**
 * `!ref` is often far larger than the populated area in these workbooks, so the
 * bounds come from the cells that actually exist, widened to cover any merge.
 */
function usedBounds(ws: XLSX.WorkSheet, merges: XLSX.Range[]) {
  let minR = Infinity;
  let maxR = -1;
  let minC = Infinity;
  let maxC = -1;

  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue;
    const cell = ws[key] as XLSX.CellObject;
    if (cell?.v === undefined || cell.v === "") continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }

  for (const range of merges) {
    if (range.s.r < minR) minR = range.s.r;
    if (range.e.r > maxR) maxR = range.e.r;
    if (range.s.c < minC) minC = range.s.c;
    if (range.e.c > maxC) maxC = range.e.c;
  }

  if (maxR < 0) return null;
  return { minR, maxR, minC: Math.min(minC, maxC), maxC };
}

/** SheetJS reports fills as `s.fgColor.rgb`, sometimes with a leading alpha. */
function fillOf(cell: XLSX.CellObject | undefined): string | undefined {
  const rgb: unknown = cell?.s?.fgColor?.rgb;
  if (typeof rgb !== "string") return undefined;
  const hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  // White fills are the default; skipping them keeps zebra striping visible.
  if (hex.toUpperCase() === "FFFFFF") return undefined;
  return `#${hex}`;
}

/** Dark fills need light text — the reader does not expose the font colour. */
function inkFor(background: string | undefined): string | undefined {
  if (!background) return undefined;
  const r = parseInt(background.slice(1, 3), 16);
  const g = parseInt(background.slice(3, 5), 16);
  const b = parseInt(background.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5 ? "#FFFFFF" : undefined;
}

export function buildGrid(
  workbook: XLSX.WorkBook,
  sheetName: string,
  rowLimit: number,
): Grid {
  const ws = workbook.Sheets[sheetName];
  const merges = (ws?.["!merges"] as XLSX.Range[] | undefined) ?? [];
  const bounds = ws ? usedBounds(ws, merges) : null;

  if (!ws || !bounds) {
    return {
      sheetNames: workbook.SheetNames,
      rows: [],
      totalRows: 0,
      colWidths: [],
      filledCount: 0,
    };
  }

  const { anchors, covered } = buildMergeIndex(merges);
  const totalRows = bounds.maxR - bounds.minR + 1;
  const lastRow = Math.min(bounds.maxR, bounds.minR + rowLimit - 1);

  const cols = (ws["!cols"] as XLSX.ColInfo[] | undefined) ?? [];
  const colWidths: number[] = [];
  for (let c = bounds.minC; c <= bounds.maxC; c++) {
    const info = cols[c];
    const px = info?.wpx ?? (info?.wch ? info.wch * 7 : undefined);
    colWidths.push(Math.min(Math.max(px ?? 96, 48), 420));
  }

  const rows: RenderCell[][] = [];
  for (let r = bounds.minR; r <= lastRow; r++) {
    const row: RenderCell[] = [];
    for (let c = bounds.minC; c <= bounds.maxC; c++) {
      if (covered.has(`${r}:${c}`)) continue;

      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      const span = anchors.get(`${r}:${c}`);
      const background = fillOf(cell);

      row.push({
        key: `${r}:${c}`,
        // `w` is the display text Excel would show (number formats applied).
        text: cell?.w ?? (cell?.v != null ? String(cell.v) : ""),
        numeric: cell?.t === "n",
        rowSpan: span?.rowSpan ?? 1,
        colSpan: span?.colSpan ?? 1,
        background,
        ink: inkFor(background),
      });
    }
    rows.push(row);
  }

  return {
    sheetNames: workbook.SheetNames,
    rows,
    totalRows,
    colWidths,
    filledCount: contentCellCount(ws),
  };
}

export function SpreadsheetViewer({ fileUrl }: { fileUrl: string }) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [rowLimit, setRowLimit] = useState(INITIAL_ROW_LIMIT);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();

    setStatus("loading");
    setError(null);
    setWorkbook(null);
    setRowLimit(INITIAL_ROW_LIMIT);

    async function load() {
      try {
        const response = await fetch(fileUrl, { signal: abort.signal });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const buffer = await response.arrayBuffer();
        if (cancelled) return;

        // Some MEC workbooks are >10 MB and parsing blocks the main thread, so
        // yield once to let the loading state paint before it starts.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled) return;

        const parsed = XLSX.read(new Uint8Array(buffer), { type: "array", cellStyles: true });
        if (cancelled) return;

        setWorkbook(parsed);
        setActiveSheet(pickDefaultSheet(parsed));
        setStatus("ready");
      } catch (err) {
        if (cancelled || (err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not read the workbook.");
        setStatus("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [fileUrl]);

  const grid = useMemo(
    () => (workbook && activeSheet ? buildGrid(workbook, activeSheet, rowLimit) : null),
    [workbook, activeSheet, rowLimit],
  );

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-steel-300 border-t-accent-500" />
          <p className="text-sm text-steel-500">Opening workbook…</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-sm rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <AlertTriangle size={28} className="mx-auto mb-3 text-amber-500" />
          <h3 className="mb-1 text-sm font-bold text-amber-900">Could not display this workbook</h3>
          <p className="text-xs text-amber-800">{error}</p>
          <p className="mt-3 text-xs text-amber-700">Use Download above to open it in Excel.</p>
        </div>
      </div>
    );
  }

  if (!grid || grid.sheetNames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-steel-500">
        This workbook has no readable sheets.
      </div>
    );
  }

  const hiddenRows = grid.totalRows - grid.rows.length;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-steel-900">
      {/* Sheet tabs — mirrors Excel's bottom tab strip */}
      {grid.sheetNames.length > 1 && (
        <div className="compact-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-steel-200 bg-steel-50 px-2 py-1.5 dark:border-steel-700 dark:bg-steel-950">
          {grid.sheetNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setActiveSheet(name);
                setRowLimit(INITIAL_ROW_LIMIT);
              }}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                name === activeSheet
                  ? "bg-white text-steel-900 shadow-sm dark:bg-steel-800 dark:text-white"
                  : "text-steel-500 hover:bg-steel-100 dark:hover:bg-steel-800"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* These standards are largely pictures pasted onto the sheet, which the
          parser cannot see. Say so rather than showing a blank-looking grid. */}
      {grid.filledCount <= NAV_SHEET_MAX_CELLS && (
        <div className="flex shrink-0 items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
          <ImageOff size={13} className="mt-0.5 shrink-0" />
          <span>
            This sheet is mostly embedded pictures, which are not rendered here. The guideline
            images appear alongside this panel — or download the file to see the original.
          </span>
        </div>
      )}

      <div className="compact-scrollbar flex-1 overflow-auto">
        {grid.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-steel-500">This sheet is empty.</div>
        ) : (
          <table className="border-collapse text-xs" style={{ tableLayout: "fixed" }}>
            <colgroup>
              {grid.colWidths.map((width, idx) => (
                <col key={idx} style={{ width }} />
              ))}
            </colgroup>
            <tbody>
              {grid.rows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {row.map((cell) => (
                    <td
                      key={cell.key}
                      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                      colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                      style={{ backgroundColor: cell.background, color: cell.ink }}
                      className={`border border-steel-200 px-2 py-1 align-top dark:border-steel-700 ${
                        cell.numeric ? "text-right tabular-nums" : "text-left"
                      } ${cell.background ? "" : "text-steel-700 dark:text-steel-200"}`}
                    >
                      <div className="whitespace-pre-wrap break-words">{cell.text}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="shrink-0 border-t border-steel-200 bg-steel-50 px-3 py-2 text-[11px] text-steel-500 dark:border-steel-700 dark:bg-steel-950 dark:text-steel-400">
        {hiddenRows > 0 ? (
          <button
            type="button"
            onClick={() => setRowLimit(grid.totalRows)}
            className="font-semibold text-accent-600 hover:text-accent-700 dark:text-accent-400"
          >
            Showing {grid.rows.length} of {grid.totalRows} rows — show all
          </button>
        ) : (
          <span>
            {grid.totalRows} rows · embedded pictures and macros are not rendered — download to
            view them.
          </span>
        )}
      </div>
    </div>
  );
}
