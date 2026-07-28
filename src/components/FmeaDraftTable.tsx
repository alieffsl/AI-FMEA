import { useMemo, useState } from "react";
import { ChevronDown, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { FmeaDraftRow, FmeaFilter } from "../types/fmea";
import { exportFmeaToExcel } from "../utils/excelExport";

type FmeaDraftTableProps = {
  rows: FmeaDraftRow[];
  onEditRow?: (id: string, updates: Partial<FmeaDraftRow>) => void;
};

const FILTER_OPTIONS: { value: FmeaFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "high-rpn", label: "High RPN" },
];

export function FmeaDraftTable({
  rows,
}: FmeaDraftTableProps) {
  const [filter, setFilter] = useState<FmeaFilter>("all");
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [expandedFailureModes, setExpandedFailureModes] = useState<Set<string>>(new Set());

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "high-rpn") return r.rpn >= 36;
      return true;
    });
  }, [rows, filter]);

  // Group by toolNo
  const grouped = useMemo(() => {
    const map = new Map<string, FmeaDraftRow[]>();
    for (const row of filteredRows) {
      const key = row.toolNo || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries());
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

      {/* Tool cards */}
      {grouped.map(([toolNo, toolRows], groupIdx) => {
        const isExpanded = expandedTools.has(toolNo);
        const firstRow = toolRows[0];

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
                <span className="font-mono text-[11px] font-semibold rounded-full bg-steel-100 px-3 py-1 text-steel-600">
                  {toolRows.length} modes
                </span>
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
                              <span className="text-[11px] font-semibold text-steel-400 uppercase tracking-wider">
                                {row.checklistEntries!.length} recommendations
                              </span>
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
                          <div className="grid grid-cols-2 gap-6 px-4 py-2.5 bg-steel-50 rounded-lg">
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
                              className={`grid grid-cols-2 gap-6 px-4 py-3.5 rounded-lg transition-colors duration-150 hover:bg-steel-50 ${
                                entryIdx % 2 === 0 
                                  ? 'bg-white'
                                  : 'bg-steel-50/50'
                              }`}
                            >
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
