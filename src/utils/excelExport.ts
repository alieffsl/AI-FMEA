// Styled workbook writer. The stock `xlsx` community build silently drops the
// `s` (style) property on write, so this module uses `xlsx-js-style`, a fork of
// the same 0.18 codebase that emits fonts/fills/borders. The API is identical.
import * as XLSX from 'xlsx-js-style';
import type { FmeaDraftRow } from '../types/fmea';
import {
  getChecklistSourceLabel,
  getStandardSourceTitles,
  type ChecklistEntry,
} from './checklistSources';

// ─────────────────────────────────────────────────────────────────────────────
// Theme — mirrors the app palette in tailwind.config.js
// ─────────────────────────────────────────────────────────────────────────────

const COLOR = {
  title: '174EA6',
  header: '1A73E8',
  band: 'F0F4F9',
  white: 'FFFFFF',
  grid: 'DADCE0',
  groupRule: '9AA0A6',
  ink: '1E1E1E',
  muted: '5F6368',
  riskHighBg: 'FCE8E6',
  riskHighInk: 'B3261E',
  riskMedBg: 'FEF7E0',
  riskMedInk: 'B06000',
  riskLowBg: 'E6F4EA',
  riskLowInk: '137333',
} as const;

const THIN = { style: 'thin', color: { rgb: COLOR.grid } };
const GROUP_RULE = { style: 'medium', color: { rgb: COLOR.groupRule } };
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };

/** RPN >= 36 is the "high risk" threshold the review UI uses. */
const RPN_HIGH = 36;
const RPN_CRITICAL = 100;

type Cell = { v: string | number; t: 's' | 'n'; z?: string; s?: any };

type Column = {
  header: string;
  width: number;
  /** Which level of the hierarchy owns the value — drives vertical merging. */
  scope: 'tool' | 'mode' | 'entry';
  align?: 'left' | 'center' | 'right';
};

// Header names are unchanged from the previous exporter so downstream sheets
// and macros that reference them keep working.
const COLUMNS: Column[] = [
  { header: 'Tool No', width: 16, scope: 'tool' },
  { header: 'Part Description', width: 24, scope: 'tool' },
  { header: 'Failure Mode', width: 26, scope: 'mode' },
  { header: 'Source', width: 24, scope: 'entry' },
  { header: 'Standard Document', width: 30, scope: 'entry' },
  { header: 'Standard Section', width: 20, scope: 'entry' },
  { header: 'Concern', width: 48, scope: 'entry' },
  { header: 'Recommendation', width: 48, scope: 'entry' },
  { header: 'Supporting Cases', width: 11, scope: 'entry', align: 'center' },
  { header: 'Similarity', width: 10, scope: 'entry', align: 'center' },
  { header: 'S', width: 4, scope: 'mode', align: 'center' },
  { header: 'O', width: 4, scope: 'mode', align: 'center' },
  { header: 'D', width: 4, scope: 'mode', align: 'center' },
  { header: 'RPN', width: 7, scope: 'mode', align: 'center' },
];

const LAST_COL = COLUMNS.length - 1;

// Layout: title, subtitle, spacer, header, then data.
const ROW_TITLE = 0;
const ROW_SUBTITLE = 1;
const ROW_HEADER = 3;
const ROW_FIRST_DATA = 4;

// ─────────────────────────────────────────────────────────────────────────────
// Style builders
// ─────────────────────────────────────────────────────────────────────────────

function titleStyle(): any {
  return {
    font: { name: 'Calibri', sz: 16, bold: true, color: { rgb: COLOR.white } },
    fill: { patternType: 'solid', fgColor: { rgb: COLOR.title } },
    alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
  };
}

function subtitleStyle(): any {
  return {
    font: { name: 'Calibri', sz: 10, italic: true, color: { rgb: COLOR.muted } },
    fill: { patternType: 'solid', fgColor: { rgb: COLOR.band } },
    alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
  };
}

function headerStyle(align: Column['align']): any {
  return {
    font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: COLOR.white } },
    fill: { patternType: 'solid', fgColor: { rgb: COLOR.header } },
    alignment: { horizontal: align ?? 'left', vertical: 'center', wrapText: true },
    border: BOX,
  };
}

function bodyStyle(options: {
  align?: Column['align'];
  banded: boolean;
  /** Merged tool/mode cells read better centred in their span. */
  merged?: boolean;
  endOfGroup?: boolean;
  muted?: boolean;
  bold?: boolean;
}): any {
  const { align, banded, merged, endOfGroup, muted, bold } = options;
  return {
    font: {
      name: 'Calibri',
      sz: 10,
      bold: Boolean(bold),
      italic: Boolean(muted),
      color: { rgb: muted ? COLOR.muted : COLOR.ink },
    },
    fill: { patternType: 'solid', fgColor: { rgb: banded ? COLOR.band : COLOR.white } },
    alignment: {
      horizontal: align ?? 'left',
      vertical: merged ? 'center' : 'top',
      wrapText: true,
    },
    border: endOfGroup ? { ...BOX, bottom: GROUP_RULE } : BOX,
  };
}

/** Traffic-light fill for the RPN column. */
function rpnStyle(rpn: number, endOfGroup: boolean): any {
  const [bg, ink] =
    rpn >= RPN_CRITICAL
      ? [COLOR.riskHighBg, COLOR.riskHighInk]
      : rpn >= RPN_HIGH
        ? [COLOR.riskMedBg, COLOR.riskMedInk]
        : [COLOR.riskLowBg, COLOR.riskLowInk];

  return {
    font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: ink } },
    fill: { patternType: 'solid', fgColor: { rgb: bg } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: endOfGroup ? { ...BOX, bottom: GROUP_RULE } : BOX,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Data shaping
// ─────────────────────────────────────────────────────────────────────────────

type ToolGroup = {
  toolNo: string;
  partDescription: string;
  modes: FmeaDraftRow[];
  /** Total worksheet rows the group occupies (one per checklist entry). */
  height: number;
};

function isNoEvidenceRow(row: FmeaDraftRow) {
  return row.hasEvidence === false || row.potentialFailureMode === 'No historical data';
}

function entriesOf(row: FmeaDraftRow): ChecklistEntry[] {
  return row.checklistEntries ?? [];
}

/** One worksheet row per checklist entry, minimum one so the mode still shows. */
function modeHeight(row: FmeaDraftRow) {
  return Math.max(1, entriesOf(row).length);
}

/**
 * Group by tool, heaviest first — the same ordering the on-screen draft uses,
 * so the sheet and the app agree on what to look at first.
 */
function groupByTool(rows: FmeaDraftRow[]): ToolGroup[] {
  const map = new Map<string, ToolGroup>();

  for (const row of rows) {
    const toolNo = row.toolNo || 'Unknown';
    let group = map.get(toolNo);
    if (!group) {
      group = { toolNo, partDescription: row.partDescription || '', modes: [], height: 0 };
      map.set(toolNo, group);
    }
    group.modes.push(row);
    group.height += modeHeight(row);
    if (!group.partDescription) group.partDescription = row.partDescription || '';
  }

  return Array.from(map.values()).sort((a, b) => b.modes.length - a.modes.length);
}

function standardSectionsOf(entry: ChecklistEntry): string {
  return Array.from(
    new Set(
      (entry.supporting_standard_refs || [])
        .map((reference) => reference.section || reference.reference)
        .filter((section): section is string => Boolean(section)),
    ),
  ).join('; ');
}

/**
 * Excel only auto-fits row height for wrapped text it has laid out itself, so
 * an unset height clips long concerns. Estimate from the longest wrapped cell.
 */
function estimateRowHeight(texts: Array<{ text: string; width: number }>): number {
  const lines = texts.reduce((most, { text, width }) => {
    const wrapped = Math.ceil((text?.length ?? 0) / Math.max(1, width - 2));
    return Math.max(most, wrapped);
  }, 1);
  return Math.min(Math.max(lines, 1), 12) * 13.5 + 6;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet builders
// ─────────────────────────────────────────────────────────────────────────────

function put(ws: XLSX.WorkSheet, r: number, c: number, cell: Cell) {
  ws[XLSX.utils.encode_cell({ r, c })] = cell;
}

function buildDetailSheet(groups: ToolGroup[], generatedAt: Date): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  const rowInfo: XLSX.RowInfo[] = [];

  const modeCount = groups.reduce((n, g) => n + g.modes.length, 0);
  const entryCount = groups.reduce(
    (n, g) => n + g.modes.reduce((m, row) => m + entriesOf(row).length, 0),
    0,
  );

  // ── Title band ──
  for (let c = 0; c <= LAST_COL; c++) {
    put(ws, ROW_TITLE, c, { v: c === 0 ? 'DRAFT FMEA — AI Generated' : '', t: 's', s: titleStyle() });
    put(ws, ROW_SUBTITLE, c, {
      v:
        c === 0
          ? `Generated ${generatedAt.toLocaleString()}  ·  ${groups.length} tools  ·  ` +
            `${modeCount} failure modes  ·  ${entryCount} evidence items  ·  ` +
            `RPN ≥ ${RPN_HIGH} highlighted`
          : '',
      t: 's',
      s: subtitleStyle(),
    });
  }
  merges.push(
    { s: { r: ROW_TITLE, c: 0 }, e: { r: ROW_TITLE, c: LAST_COL } },
    { s: { r: ROW_SUBTITLE, c: 0 }, e: { r: ROW_SUBTITLE, c: LAST_COL } },
  );
  rowInfo[ROW_TITLE] = { hpt: 30 };
  rowInfo[ROW_SUBTITLE] = { hpt: 18 };
  rowInfo[ROW_HEADER - 1] = { hpt: 6 };

  // ── Header row ──
  COLUMNS.forEach((col, c) => {
    put(ws, ROW_HEADER, c, { v: col.header, t: 's', s: headerStyle(col.align) });
  });
  rowInfo[ROW_HEADER] = { hpt: 30 };

  // ── Data ──
  let r = ROW_FIRST_DATA;

  groups.forEach((group, groupIdx) => {
    const banded = groupIdx % 2 === 1;
    const groupStart = r;
    const groupEnd = groupStart + group.height - 1;

    for (const mode of group.modes) {
      const modeStart = r;
      const modeEnd = modeStart + modeHeight(mode) - 1;
      const entries = entriesOf(mode);
      const noEvidence = isNoEvidenceRow(mode);

      // Rows the mode owns: one per entry, or a single placeholder line.
      const lines: Array<ChecklistEntry | null> = entries.length ? entries : [null];

      lines.forEach((entry, lineIdx) => {
        const rowIdx = modeStart + lineIdx;
        const endOfGroup = rowIdx === groupEnd;
        const cellStyle = (col: Column, merged = false) =>
          bodyStyle({ align: col.align, banded, merged, endOfGroup });

        const concern = entry
          ? entry.concern
          : noEvidence
            ? 'No historical evidence matched this tool.'
            : 'No checklist evidence available.';
        const recommendation = entry ? entry.recommendation : '—';

        // Tool-scoped columns: value on the group's first row only.
        const isToolAnchor = rowIdx === groupStart;
        put(ws, rowIdx, 0, {
          v: isToolAnchor ? group.toolNo : '',
          t: 's',
          s: bodyStyle({ banded, merged: true, endOfGroup, bold: true }),
        });
        put(ws, rowIdx, 1, {
          v: isToolAnchor ? group.partDescription : '',
          t: 's',
          s: bodyStyle({ banded, merged: true, endOfGroup }),
        });

        // Mode-scoped columns: value on the mode's first row only.
        const isModeAnchor = lineIdx === 0;
        put(ws, rowIdx, 2, {
          v: isModeAnchor ? mode.potentialFailureMode : '',
          t: 's',
          s: bodyStyle({ banded, merged: true, endOfGroup, muted: noEvidence }),
        });

        // Entry-scoped columns.
        put(ws, rowIdx, 3, {
          v: entry ? getChecklistSourceLabel(entry) : 'No matched evidence',
          t: 's',
          s: bodyStyle({ banded, endOfGroup, muted: !entry }),
        });
        put(ws, rowIdx, 4, {
          v: entry ? getStandardSourceTitles(entry).join('; ') : '',
          t: 's',
          s: cellStyle(COLUMNS[4]),
        });
        put(ws, rowIdx, 5, {
          v: entry ? standardSectionsOf(entry) : '',
          t: 's',
          s: cellStyle(COLUMNS[5]),
        });
        put(ws, rowIdx, 6, {
          v: concern,
          t: 's',
          s: bodyStyle({ banded, endOfGroup, muted: !entry }),
        });
        put(ws, rowIdx, 7, {
          v: recommendation,
          t: 's',
          s: bodyStyle({ banded, endOfGroup, muted: !entry }),
        });
        put(ws, rowIdx, 8, {
          v: entry ? entry.supporting_record_count ?? 0 : 0,
          t: 'n',
          s: cellStyle(COLUMNS[8]),
        });
        // Stored as a real fraction so the column sorts and averages correctly.
        put(ws, rowIdx, 9, {
          v: entry?.similarity != null ? entry.similarity : '',
          t: entry?.similarity != null ? 'n' : 's',
          z: entry?.similarity != null ? '0%' : undefined,
          s: cellStyle(COLUMNS[9]),
        });

        // Mode-scoped S / O / D / RPN.
        const sod: Array<[number, number]> = [
          [10, mode.severity],
          [11, mode.occurrence],
          [12, mode.detection],
        ];
        for (const [c, value] of sod) {
          put(ws, rowIdx, c, {
            v: isModeAnchor ? value ?? 0 : '',
            t: isModeAnchor ? 'n' : 's',
            s: bodyStyle({ align: 'center', banded, merged: true, endOfGroup }),
          });
        }
        put(ws, rowIdx, 13, {
          v: isModeAnchor ? mode.rpn ?? 0 : '',
          t: isModeAnchor ? 'n' : 's',
          s: rpnStyle(mode.rpn ?? 0, endOfGroup),
        });

        rowInfo[rowIdx] = {
          hpt: estimateRowHeight([
            { text: concern, width: COLUMNS[6].width },
            { text: recommendation, width: COLUMNS[7].width },
            { text: entry ? getStandardSourceTitles(entry).join('; ') : '', width: COLUMNS[4].width },
          ]),
        };
      });

      // Merge the mode-scoped columns down the mode's rows.
      if (modeEnd > modeStart) {
        for (const c of [2, 10, 11, 12, 13]) {
          merges.push({ s: { r: modeStart, c }, e: { r: modeEnd, c } });
        }
      }

      r = modeEnd + 1;
    }

    // Merge the tool-scoped columns down the whole group.
    if (groupEnd > groupStart) {
      for (const c of [0, 1]) {
        merges.push({ s: { r: groupStart, c }, e: { r: groupEnd, c } });
      }
    }
  });

  const lastRow = Math.max(r - 1, ROW_HEADER);
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: LAST_COL } });
  ws['!merges'] = merges;
  ws['!cols'] = COLUMNS.map((col) => ({ wch: col.width }));
  ws['!rows'] = rowInfo;
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: ROW_HEADER, c: 0 },
      e: { r: lastRow, c: LAST_COL },
    }),
  };

  return ws;
}

const SUMMARY_COLUMNS: Column[] = [
  { header: '#', width: 5, scope: 'tool', align: 'center' },
  { header: 'Tool No', width: 18, scope: 'tool' },
  { header: 'Part Description', width: 30, scope: 'tool' },
  { header: 'Failure Modes', width: 13, scope: 'tool', align: 'center' },
  { header: 'Evidence Items', width: 13, scope: 'tool', align: 'center' },
  { header: 'Max RPN', width: 10, scope: 'tool', align: 'center' },
  { header: 'Avg RPN', width: 10, scope: 'tool', align: 'center' },
  { header: 'Status', width: 20, scope: 'tool' },
];

function buildSummarySheet(groups: ToolGroup[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const lastCol = SUMMARY_COLUMNS.length - 1;

  SUMMARY_COLUMNS.forEach((col, c) => {
    put(ws, 0, c, { v: col.header, t: 's', s: headerStyle(col.align) });
  });

  groups.forEach((group, idx) => {
    const r = idx + 1;
    const banded = idx % 2 === 1;
    const scored = group.modes.filter((m) => !isNoEvidenceRow(m));
    const evidenceItems = group.modes.reduce((n, m) => n + entriesOf(m).length, 0);
    const maxRpn = scored.length ? Math.max(...scored.map((m) => m.rpn ?? 0)) : 0;
    const avgRpn = scored.length
      ? Math.round(scored.reduce((s, m) => s + (m.rpn ?? 0), 0) / scored.length)
      : 0;
    const allNoEvidence = scored.length === 0;

    const values: Array<[number, string | number, 's' | 'n']> = [
      [0, idx + 1, 'n'],
      [1, group.toolNo, 's'],
      [2, group.partDescription, 's'],
      [3, allNoEvidence ? 0 : group.modes.length, 'n'],
      [4, evidenceItems, 'n'],
      [5, maxRpn, 'n'],
      [6, avgRpn, 'n'],
      [7, allNoEvidence ? 'No historical data' : 'Drafted', 's'],
    ];

    for (const [c, v, t] of values) {
      const style =
        c === 5 && !allNoEvidence
          ? rpnStyle(maxRpn, false)
          : bodyStyle({
              align: SUMMARY_COLUMNS[c].align,
              banded,
              merged: true,
              muted: allNoEvidence,
              bold: c === 1,
            });
      put(ws, r, c, { v, t, s: style });
    }
  });

  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: groups.length, c: lastCol },
  });
  ws['!cols'] = SUMMARY_COLUMNS.map((col) => ({ wch: col.width }));
  ws['!rows'] = [{ hpt: 26 }];
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: groups.length, c: lastCol } }),
  };

  return ws;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

function timestampForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/**
 * Export FMEA draft rows to a formatted Excel workbook.
 *
 * Sheet 1 "FMEA Draft" — one row per checklist entry, with the tool, part,
 * failure mode and S/O/D/RPN cells merged down the rows they cover so each
 * value is stated once. Sheet 2 "Summary" — one row per tool, heaviest first.
 */
export function exportFmeaToExcel(rows: FmeaDraftRow[]): void {
  const generatedAt = new Date();
  const groups = groupByTool(rows);

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: 'Draft FMEA',
    Subject: 'AI-generated failure mode and effects analysis',
    CreatedDate: generatedAt,
  };

  XLSX.utils.book_append_sheet(workbook, buildDetailSheet(groups, generatedAt), 'FMEA Draft');
  XLSX.utils.book_append_sheet(workbook, buildSummarySheet(groups), 'Summary');

  const filename = `FMEA_Draft_${timestampForFilename(generatedAt)}.xlsx`;
  XLSX.writeFile(workbook, filename);

  console.info(
    `[Export] ${filename} — ${groups.length} tools, ${rows.length} failure modes`,
  );
}
