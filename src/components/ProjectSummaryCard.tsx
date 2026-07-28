import { Factory, FileSpreadsheet, Calendar, Layers, Clock, Hash, RefreshCcw, Tag } from "lucide-react";
import type { ProjectMetadata, ToolRow } from "../types/project";

type ProjectSummaryCardProps = {
  metadata: ProjectMetadata;
  toolRows: ToolRow[];
  onReset: () => void;
};

function InfoCard({ icon: Icon, label, value }: { icon: typeof Factory; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-steel-200 bg-white p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-steel-400">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-50 text-accent-500">
          <Icon size={12} />
        </div>
        {label}
      </div>
      <div className="mt-2.5 font-mono-eng text-base font-semibold text-steel-900 truncate" title={value || "—"}>
        {value || "—"}
      </div>
    </div>
  );
}

export function ProjectSummaryCard({ metadata, toolRows, onReset }: ProjectSummaryCardProps) {
  const rowsWithImages = toolRows.filter((r) => r.images.length > 0).length;
  const rowsGenerated = toolRows.filter((r) => r.draftStatus === "generated").length;
  const selectedCount = toolRows.filter((r) => r.selected).length;

  return (
    <section className="accent-bar-top animate-slide-up rounded-2xl border border-steel-200 bg-white shadow-panel overflow-hidden">
      <div className="p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent-500">
              Generate Draft AI FMEA
            </p>
            <h2 className="mt-1.5 text-2xl font-bold text-steel-900 truncate">
              {metadata.projectName || "Untitled Project"}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-steel-500">
              <FileSpreadsheet size={14} className="text-steel-400" />
              <span className="font-medium">{metadata.sourceFilename}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-xl border border-steel-200 bg-white px-4 py-2.5 text-sm font-medium text-steel-700 shadow-xs transition-all duration-200 hover:border-steel-300 hover:bg-steel-50 active:scale-[0.97]"
          >
            <RefreshCcw size={15} />
            Upload New File
          </button>
        </div>

        {/* Info cards */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <InfoCard icon={Factory} label="Tool Maker" value={metadata.toolMaker} />
          <InfoCard icon={Tag} label="Vendor" value={metadata.vendor} />
          <InfoCard icon={Layers} label="Quote Type" value={metadata.quoteType} />
          <InfoCard icon={Calendar} label="Toy Year" value={metadata.toyYear} />
          <InfoCard icon={Hash} label="Revision" value={metadata.revision || "—"} />
          <InfoCard icon={Clock} label="Lead Time" value={metadata.leadTimeDays ? `${metadata.leadTimeDays} days` : "—"} />
        </div>

        {/* Stats bar */}
        <div className="mt-6 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
          <div className="flex items-center gap-1.5 rounded-full bg-steel-100 px-3 py-1.5 text-steel-700">
            <span className="h-1.5 w-1.5 rounded-full bg-steel-500" />
            {toolRows.length} tool rows
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1.5 text-accent-600">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
            {selectedCount} selected
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-blue-700">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            {rowsWithImages} with images
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {rowsGenerated} drafted
          </div>
          {metadata.toolPlan ? (
            <div className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {metadata.toolPlan}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
