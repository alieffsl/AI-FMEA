import { useMemo } from "react";
import type { ToolRow, ToolImage } from "../types/project";
import { StatusBadge } from "./ui/StatusBadge";
import { ToolImageUploader } from "./ToolImageUploader";

type ToolingTableProps = {
  toolRows: ToolRow[];
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onImagesChange: (toolRowId: string, images: ToolImage[]) => void;
};

type Column = {
  key: string;
  label: string;
  minWidth: string;
  align?: "right" | "center";
  mono?: boolean;
  render: (row: ToolRow) => React.ReactNode;
};

export function ToolingTable({ toolRows, onToggleSelect, onToggleSelectAll, onImagesChange }: ToolingTableProps) {
  const allSelected = toolRows.length > 0 && toolRows.every((r) => r.selected);
  const someSelected = toolRows.some((r) => r.selected) && !allSelected;

  const columns: Column[] = useMemo(
    () => [
      {
        key: "toolNo",
        label: "Tool No.",
        minWidth: "min-w-[120px]",
        render: (row) => (
          <span className="font-semibold text-steel-900">{row.toolNo || "—"}</span>
        ),
      },
      {
        key: "toolDescription",
        label: "Part Description",
        minWidth: "min-w-[180px]",
        render: (row) => (
          <div>
            <div className="font-medium text-steel-900">{row.toolDescription || row.partDescription || "—"}</div>
            {row.material || row.gateType ? (
              <div className="mt-0.5 text-xs text-steel-500">
                {[row.material, row.gateType].filter(Boolean).join(" / ")}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        key: "partWeight",
        label: "Weight (g)",
        minWidth: "min-w-[80px]",
        align: "right",
        mono: true,
        render: (row) => <span className="font-mono text-steel-600 tabular-nums">{row.partWeight ?? "—"}</span>,
      },
      {
        key: "cavity",
        label: "Cav",
        minWidth: "min-w-[60px]",
        align: "center",
        mono: true,
        render: (row) => <span className="font-mono text-steel-600 tabular-nums">{row.cavity ?? "—"}</span>,
      },
      {
        key: "toolAid",
        label: "Tool Aid",
        minWidth: "min-w-[80px]",
        render: (row) => <span className="text-steel-600">{row.toolAid || "—"}</span>,
      },
      {
        key: "toolBuild",
        label: "Tool Build",
        minWidth: "min-w-[90px]",
        render: (row) => <span className="text-steel-600">{row.toolBuild || "—"}</span>,
      },
      {
        key: "dimensions",
        label: "L / W / H / THK",
        minWidth: "min-w-[140px]",
        mono: true,
        render: (row) => (
          <span className="font-mono text-xs text-steel-500 tabular-nums">
            {[row.length, row.width, row.height, row.thickness]
              .map((v) => (v != null ? String(v) : "—"))
              .join(" / ")}
          </span>
        ),
      },
      {
        key: "slides",
        label: "Slides",
        minWidth: "min-w-[60px]",
        align: "center",
        mono: true,
        render: (row) => <span className="font-mono text-steel-600 tabular-nums">{row.slides ?? "—"}</span>,
      },
      {
        key: "color",
        label: "Color",
        minWidth: "min-w-[80px]",
        render: (row) => <span className="text-steel-600">{row.color || "—"}</span>,
      },
      {
        key: "machineTonnage",
        label: "M/C Ton",
        minWidth: "min-w-[80px]",
        align: "right",
        mono: true,
        render: (row) => <span className="font-mono text-steel-600 tabular-nums">{row.machineTonnage ?? "—"}</span>,
      },
      {
        key: "className",
        label: "Class",
        minWidth: "min-w-[60px]",
        align: "center",
        render: (row) => (
          <span className="font-medium text-steel-700">{row.className || "—"}</span>
        ),
      },
      {
        key: "images",
        label: "Images",
        minWidth: "min-w-[160px]",
        render: (row) => (
          <ToolImageUploader
            images={row.images}
            toolRowId={row.id}
            onImagesChange={onImagesChange}
          />
        ),
      },
      {
        key: "draftStatus",
        label: "Draft Status",
        minWidth: "min-w-[100px]",
        align: "center",
        render: (row) => <StatusBadge status={row.draftStatus} />,
      },
    ],
    [onImagesChange],
  );

  if (toolRows.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-steel-200 bg-white p-10 text-center text-sm text-steel-500">
        No tool rows to display.
      </div>
    );
  }

  return (
    <section className="animate-slide-up overflow-hidden rounded-2xl border border-steel-200 bg-white shadow-panel">
      {/* Table header info */}
      <div className="flex items-center justify-between border-b border-steel-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-steel-900">Tool Rows</h3>
        <span className="font-mono text-xs text-steel-400">
          {toolRows.filter(r => r.selected).length} of {toolRows.length} selected
        </span>
      </div>

      <div className="compact-scrollbar max-h-[520px] overflow-auto">
        <table className="w-full min-w-[1400px] text-left text-sm">
          <thead className="sticky top-0 z-20 bg-steel-50 dark:bg-steel-950">
            <tr className="border-b border-steel-200 dark:border-steel-800">
              {/* Checkbox header */}
              <th className="sticky left-0 z-30 bg-steel-50 dark:bg-steel-950 px-3 py-3 w-12 min-w-[48px] max-w-[48px]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={onToggleSelectAll}
                  className="h-4 w-4 rounded border-steel-300 accent-accent-500 cursor-pointer dark:border-steel-600 dark:bg-steel-800"
                />
              </th>
              <th className="px-3 py-3 w-12 min-w-[48px] max-w-[48px] text-[10px] font-semibold uppercase tracking-wider text-steel-400">
                #
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-steel-400 dark:text-steel-400 ${col.minWidth} ${
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""
                  }`}
                >
                  {col.label}
                </th>
              ))}
              {/* Spacer column to absorb extra width */}
              <th className="w-full px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-100 dark:divide-steel-800/50">
            {toolRows.map((row, index) => (
              <tr
                key={row.id}
                className={`group align-top transition-colors duration-150 ${
                  row.selected
                    ? "bg-accent-50/50 dark:bg-accent-500/10"
                    : "bg-white hover:bg-steel-50/60 dark:bg-steel-900 dark:hover:bg-steel-800/50"
                }`}
              >
                {/* Selected indicator + checkbox */}
                <td className={`sticky left-0 z-10 bg-inherit px-3 py-3 w-12 min-w-[48px] max-w-[48px] ${row.selected ? "border-l-2 border-l-accent-500" : "border-l-2 border-l-transparent"}`}>
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={() => onToggleSelect(row.id)}
                    className="h-4 w-4 rounded border-steel-300 accent-accent-500 cursor-pointer dark:border-steel-600 dark:bg-steel-800"
                  />
                </td>
                {/* Row number */}
                <td className="px-3 py-3 w-12 min-w-[48px] max-w-[48px] font-mono text-xs text-steel-400 tabular-nums dark:text-steel-500">
                  {index + 1}
                </td>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-3 ${col.minWidth} ${
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""
                    }`}
                  >
                    {col.render(row)}
                  </td>
                ))}
                {/* Spacer cell */}
                <td className="w-full px-3 py-3"></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
