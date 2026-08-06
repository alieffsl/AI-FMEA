import { useMemo, useState } from "react";
import { ChevronDown, Download, AlertTriangle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import type { FmeaDraftRow, FmeaFilter } from "../types/fmea";
import { exportFmeaToExcel } from "../utils/excelExport";
import {
  CHECKLIST_SOURCE_LABELS,
  countChecklistSources,
  getChecklistSourceKinds,
  getStandardSourceTitles,
  type ChecklistSourceKind,
} from "../utils/checklistSources";

type FmeaDraftTableProps = {
  rows: FmeaDraftRow[];
  onEditRow?: (id: string, updates: Partial<FmeaDraftRow>) => void;
};

const FILTER_OPTIONS: { value: FmeaFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "high-rpn", label: "High RPN" },
];

/**
 * A placeholder row the generator emits for a tool with no historical match.
 * Older saved drafts predate the `hasEvidence` flag, so the failure mode text
 * is checked as a fallback.
 */
function isNoEvidenceRow(row: FmeaDraftRow) {
  return row.hasEvidence === false || row.potentialFailureMode === "No historical data";
}

const SOURCE_BADGE_STYLES: Record<ChecklistSourceKind, string> = {
  historical_fmea: "border-steel-200 bg-steel-100 text-steel-700",
  product_standard: "border-blue-200 bg-blue-50 text-blue-700",
  baseline_standard: "border-violet-200 bg-violet-50 text-violet-700",
};

function SourceBadge({ source }: { source: ChecklistSourceKind }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold leading-none ${SOURCE_BADGE_STYLES[source]}`}
    >
      {CHECKLIST_SOURCE_LABELS[source]}
    </span>
  );
}

export function FmeaDraftTable({
  rows,
}: FmeaDraftTableProps) {
  const [filter, setFilter] = useState<FmeaFilter>("all");
  const [showNoEvidence, setShowNoEvidence] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [expandedFailureModes, setExpandedFailureModes] = useState<Set<string>>(new Set());

  const noEvidenceCount = useMemo(() => rows.filter(isNoEvidenceRow).length, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!showNoEvidence && isNoEvidenceRow(r)) return false;
      if (filter === "high-rpn") return r.rpn >= 36;
      return true;
    });
  }, [rows, filter, showNoEvidence]);

  // Group by toolNo, heaviest parts first. Sorting on mode count puts the tools
  // that need the most review at the top instead of leaving them scattered
  // through the CDI row order; ties keep that original order (stable sort).
  const grouped = useMemo(() => {
    const map = new Map<string, FmeaDraftRow[]>();
    for (const row of filteredRows) {
      const key = row.toolNo || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filteredRows]);

  function toggleTool(toolNo: string) {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolNo)) next.delete(toolNo);
      else next.add(toolNo);
      return next;
    });
  }

  function toggleFailureMode(failureModeId: string) {
    setExpandedFailureModes((prev) => {
      const next = new Set(prev);
      if (next.has(failureModeId)) next.delete(failureModeId);
      else next.add(failureModeId);
      return next;
    });
  }

  function handleExport() {
    exportFmeaToExcel(rows);
  }

  // Summary metrics
  const summary = {
    total: rows.length,
    highRpn: rows.filter((r) => r.rpn >= 36).length,
    avgRpn: rows.length
      ? Math.round(rows.reduce((s, r) => s + r.rpn, 0) / rows.length)
      : 0,
  };

  if (rows.length === 0) return null;

  return (
    <section className="animate-slide-up space-y-6">
      {/* Stats bar — consistent with project card pill style */}
      <div className="rounded-2xl border border-steel-200 bg-white px-6 py-5 shadow-panel">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-steel-400 mb-1">Total modes</div>
              <div className="font-mono text-2xl font-bold text-steel-900">{summary.total}</div>
            </div>
            
            <div className="h-10 w-px bg-steel-200" />
            
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600 mb-1">
                <AlertTriangle size={12} />
                <span>High risk</span>
              </div>
              <div className="font-mono text-2xl font-bold text-steel-900">{summary.highRpn}</div>
            </div>
            
            <div className="h-10 w-px bg-steel-200" />
            
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-steel-400 mb-1">Avg RPN</div>
              <div className="font-mono text-2xl font-bold text-steel-900">{summary.avgRpn}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFilter(opt.value)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${
                  filter === opt.value
                    ? "bg-accent-500 text-white shadow-sm"
                    : "bg-steel-50 text-steel-700 hover:bg-steel-100"
                }`}
              >
                {opt.label}
              </button>
            ))}

            {noEvidenceCount > 0 && (
              <button
                type="button"
                onClick={() => setShowNoEvidence((v) => !v)}
                aria-pressed={showNoEvidence}
                title={
                  showNoEvidence
                    ? "Hide tools with no historical match"
                    : "Show tools with no historical match"
                }
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${
                  showNoEvidence
                    ? "bg-amber-500 text-white shadow-sm"
                    : "bg-steel-50 text-steel-700 hover:bg-steel-100"
                }`}
              >
                {showNoEvidence ? <Eye size={14} /> : <EyeOff size={14} />}
                No historical data
                <span
                  className={`font-mono text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                    showNoEvidence ? "bg-white/20 text-white" : "bg-steel-200 text-steel-600"
                  }`}
                >
                  {noEvidenceCount}
                </span>
              </button>
            )}

            <button
              onClick={handleExport}
              className="flex items-center gap-2 rounded-xl border border-steel-200 bg-white px-4 py-2 text-sm font-medium text-steel-700 transition-all duration-200 hover:bg-steel-50 hover:border-steel-300"
            >
              <Download size={14} />
              Export Excel
            </button>
          </div>
        </div>
      </div>

      {/* Every row is filtered out — say so instead of showing a bare stats bar. */}
      {grouped.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-steel-200 bg-white p-10 text-center text-sm text-steel-500">
          {filter === "high-rpn"
            ? "No modes above the high-RPN threshold."
            : "Every tool in this draft is missing historical data. Turn on “No historical data” to see them."}
        </div>
      )}

      {/* Tool cards */}
      {grouped.map(([toolNo, toolRows], groupIdx) => {
        const isExpanded = expandedTools.has(toolNo);
        const firstRow = toolRows[0];
        const allNoEvidence = toolRows.every(isNoEvidenceRow);

        return (
          <div key={toolNo} className="overflow-hidden bg-white rounded-2xl border border-steel-200 shadow-panel">
            {/* Header */}
            <button
              type="button"
              onClick={() => toggleTool(toolNo)}
              className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors duration-150 hover:bg-steel-50/60"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 font-mono text-sm font-semibold text-accent-600">
                {groupIdx + 1}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-steel-900">{firstRow?.partDescription}</div>
                <div className="text-sm text-steel-500 truncate">{toolNo}</div>
              </div>
              
              <div className="flex items-center gap-3 text-sm text-steel-500">
                {allNoEvidence ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                    No historical data
                  </span>
                ) : (
                  <span className="font-mono text-[11px] font-semibold rounded-full bg-steel-100 px-3 py-1 text-steel-600">
                    {toolRows.length} modes
                  </span>
                )}
                <ChevronDown 
                  size={18} 
                  className={`text-steel-400 transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
                />
              </div>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-steel-100 px-6 pb-6 space-y-4">
                {[...toolRows].sort((a, b) => (b.checklistEntries?.length || 0) - (a.checklistEntries?.length || 0)).map((row, modeIdx) => {
                  const hasChecklist = row.checklistEntries && row.checklistEntries.length > 0;
                  const isFailureModeExpanded = expandedFailureModes.has(row.id);
                  const sourceCounts = hasChecklist
                    ? countChecklistSources(row.checklistEntries!)
                    : null;

                  return (
                    <div key={row.id} className="pt-4">
                      {/* Failure mode header - now clickable */}
                      <button
                        type="button"
                        onClick={() => toggleFailureMode(row.id)}
                        className="w-full mb-4 pb-3 border-b border-steel-100"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-steel-100 font-mono text-xs font-semibold text-steel-600">
                              {modeIdx + 1}
                            </div>
                            <div className="font-medium text-steel-900 text-left">
                              {row.potentialFailureMode}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {hasChecklist && (
                              <div className="flex flex-wrap justify-end gap-1.5">
                                {sourceCounts!.historical_fmea > 0 && (
                                  <span className="rounded-full bg-steel-100 px-2 py-1 text-[10px] font-semibold text-steel-600">
                                    {sourceCounts!.historical_fmea} Previous FMEA
                                  </span>
                                )}
                                {sourceCounts!.product_standard > 0 && (
                                  <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
                                    {sourceCounts!.product_standard} MEC
                                  </span>
                                )}
                                {sourceCounts!.baseline_standard > 0 && (
                                  <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">
                                    {sourceCounts!.baseline_standard} Baseline
                                  </span>
                                )}
                              </div>
                            )}
                            <ChevronDown 
                              size={16} 
                              className={`text-steel-400 transition-transform duration-200 ${isFailureModeExpanded ? 'rotate-0' : '-rotate-90'}`}
                            />
                          </div>
                        </div>
                      </button>
                      
                      {/* Checklist entries - only show when expanded */}
                      {isFailureModeExpanded && hasChecklist && (
                        <div className="space-y-2">
                          {/* Column headers */}
                          <div className="hidden lg:grid lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)] gap-6 px-4 py-2.5 bg-steel-50 rounded-lg">
                            <div className="text-[10px] font-semibold text-steel-500 uppercase tracking-wider">
                              Evidence source
                            </div>
                            <div className="text-[10px] font-semibold text-steel-500 uppercase tracking-wider">
                              Concern
                            </div>
                            <div className="text-[10px] font-semibold text-steel-500 uppercase tracking-wider">
                              Recommendation
                            </div>
                          </div>
                          
                          {/* Rows — clean alternation */}
                          {row.checklistEntries!.map((entry, entryIdx) => (
                            <div 
                              key={entry.id} 
                              className={`grid grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)] gap-4 lg:gap-6 px-4 py-3.5 rounded-lg transition-colors duration-150 hover:bg-steel-50 ${
                                entryIdx % 2 === 0 
                                  ? 'bg-white'
                                  : 'bg-steel-50/50'
                              }`}
                            >
                              {/* Evidence source */}
                              <div>
                                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-steel-400 lg:hidden">
                                  Evidence source
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {getChecklistSourceKinds(entry).map((source) => (
                                    <SourceBadge key={source} source={source} />
                                  ))}
                                </div>
                                {getStandardSourceTitles(entry).map((title) => (
                                  <div key={title} className="mt-1.5 text-[11px] leading-snug text-steel-500">
                                    {title}
                                  </div>
                                ))}
                              </div>

                              {/* Concern */}
                              <div className="flex items-start gap-3">
                                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold text-steel-400 bg-steel-100">
                                  {entryIdx + 1}
                                </div>
                                <div className="text-sm text-steel-700 leading-relaxed">
                                  {entry.concern}
                                </div>
                              </div>
                              
                              {/* Recommendation */}
                              <div className="flex items-start gap-3">
                                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50">
                                  <CheckCircle2 size={13} className="text-emerald-500" />
                                </div>
                                <div className="text-sm text-steel-700 leading-relaxed">
                                  {entry.recommendation}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {isFailureModeExpanded && !hasChecklist && (
                        <div className="rounded-lg bg-steel-50 border border-steel-100 px-4 py-3 text-center text-sm text-steel-500">
                          No previous FMEA recommendations available
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
