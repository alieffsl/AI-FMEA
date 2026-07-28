import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Sparkles, WandSparkles, X } from "lucide-react";
import type { AiSuggestion, NewToolInput, ReviewStatus } from "../../data/fmeaMockData";
import { demoNewTools } from "../../data/fmeaMockData";
import { cdiNewTools, cdiProject } from "../../data/cdiMockData";
import { consolidateToolRows } from "../../lib/fmeaEngine";
import { FmeaSuggestionTable } from "../fmea/FmeaSuggestionTable";

type NewToyGeneratorProps = {
  suggestions: AiSuggestion[];
  selectedToy: string;
  onSelectedToyChange: (toy: string) => void;
  onGenerate: (rows: NewToolInput[]) => void;
  onViewEvidence: (suggestion: AiSuggestion) => void;
  onStatusChange: (id: string, status: ReviewStatus) => void;
  onRecommendationChange: (id: string, recommendation: string) => void;
  onValidationCommentChange: (id: string, validationComment: string) => void;
};

type EditableFieldKey =
  | "toolNo"
  | "refPartNumber"
  | "toolDescription"
  | "qtyPerToy"
  | "cavity"
  | "material"
  | "cycleTimeSec"
  | "weeklyCapacityToys"
  | "gateType"
  | "moldMaterial"
  | "partWeightG"
  | "toolAid"
  | "toolBuild"
  | "sizeL"
  | "sizeW"
  | "sizeH"
  | "sizeThk"
  | "slideCount"
  | "color"
  | "machineTon"
  | "toolClass";

const editableFields: Array<{ key: EditableFieldKey; label: string; width: string; numeric?: boolean }> = [
  { key: "toolNo", label: "Tool No.", width: "w-36" },
  { key: "refPartNumber", label: "Ref Part", width: "w-24" },
  { key: "toolDescription", label: "Part Description", width: "w-40" },
  { key: "qtyPerToy", label: "Qty/Toy", width: "w-20", numeric: true },
  { key: "cavity", label: "Cav", width: "w-20", numeric: true },
  { key: "material", label: "Resin Mat'l", width: "w-24" },
  { key: "cycleTimeSec", label: "Cycle Sec", width: "w-24", numeric: true },
  { key: "weeklyCapacityToys", label: "Weekly Cap K", width: "w-28", numeric: true },
  { key: "gateType", label: "Gating", width: "w-28" },
  { key: "moldMaterial", label: "Insert Mat'l", width: "w-24" },
  { key: "partWeightG", label: "Part Weight", width: "w-24", numeric: true },
  { key: "toolAid", label: "Tool Aid", width: "w-24" },
  { key: "toolBuild", label: "Tool Build", width: "w-28" },
  { key: "sizeL", label: "L", width: "w-20", numeric: true },
  { key: "sizeW", label: "W", width: "w-20", numeric: true },
  { key: "sizeH", label: "H", width: "w-20", numeric: true },
  { key: "sizeThk", label: "THK", width: "w-20", numeric: true },
  { key: "slideCount", label: "# Slides", width: "w-20", numeric: true },
  { key: "color", label: "Color", width: "w-24" },
  { key: "machineTon", label: "M/C Ton", width: "w-24", numeric: true },
  { key: "toolClass", label: "Class", width: "w-20" },
];

function SummaryTile({ label, value, onClick }: { label: string; value: number | string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-steel-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-steel-400"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-steel-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-steel-950">{value}</div>
      <div className="mt-1 text-xs font-semibold text-steel-500">View</div>
    </button>
  );
}

function SuggestionDrilldown({
  title,
  rows,
  onClose,
}: {
  title: string;
  rows: AiSuggestion[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close suggestion drilldown overlay"
        className="absolute inset-0 bg-steel-950/35"
        onClick={onClose}
      />
      <section className="relative z-10 flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-md bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-steel-200 p-5">
          <div>
            <p className="text-sm font-medium text-steel-500">Generated FMEA rows</p>
            <h2 className="mt-1 text-xl font-bold text-steel-950">{title}</h2>
            <p className="mt-1 text-sm text-steel-500">{rows.length} suggestion(s)</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-steel-200 p-2 text-steel-700 hover:bg-steel-100"
            title="Close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="compact-scrollbar flex-1 overflow-auto">
          {rows.length ? (
            <table className="min-w-[980px] divide-y divide-steel-200 text-left text-sm">
              <thead className="sticky top-0 bg-steel-100 text-xs uppercase tracking-wide text-steel-600">
                <tr>
                  <th className="px-3 py-3">Tool</th>
                  <th className="px-3 py-3">Potential Failure</th>
                  <th className="px-3 py-3">RPN</th>
                  <th className="px-3 py-3">Confidence</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">RAG action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-steel-100">
                {rows.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-steel-50">
                    <td className="px-3 py-3">
                      <div className="font-semibold">{item.toolNo}</div>
                      <div className="text-xs text-steel-500">{item.toolDescription}</div>
                    </td>
                    <td className="px-3 py-3 font-semibold">{item.failure}</td>
                    <td className="px-3 py-3">{item.rpn}</td>
                    <td className="px-3 py-3">{item.confidence}</td>
                    <td className="px-3 py-3">{item.reviewStatus}</td>
                    <td className="min-w-[360px] px-3 py-3 text-steel-600">
                      {item.recommendedActions[0] ?? item.recommendation}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-sm text-steel-500">No suggestions match this summary.</div>
          )}
        </div>
      </section>
    </div>
  );
}

export function NewToyGenerator({
  suggestions,
  selectedToy,
  onSelectedToyChange,
  onGenerate,
  onViewEvidence,
  onStatusChange,
  onRecommendationChange,
  onValidationCommentChange,
}: NewToyGeneratorProps) {
  const [source, setSource] = useState<"cdi" | "demo">(selectedToy === "NEW-DEMO-001" ? "demo" : "cdi");
  const [rows, setRows] = useState<NewToolInput[]>(cdiNewTools);
  const [summaryDrilldown, setSummaryDrilldown] = useState<{ title: string; rows: AiSuggestion[] } | null>(null);

  const summary = useMemo(
    () => ({
      total: suggestions.length,
      high: suggestions.filter((item) => item.confidence === "High").length,
      medium: suggestions.filter((item) => item.confidence === "Medium").length,
      needsReview: suggestions.filter((item) => item.reviewStatus === "Needs Engineer Review").length,
      highRpn: suggestions.filter((item) => item.rpn >= 36).length,
    }),
    [suggestions],
  );

  const projectLabel = source === "cdi" ? `${cdiProject.projectCode} - ${cdiProject.toyName}` : "NEW-DEMO-001";
  const projectDetail =
    source === "cdi"
      ? `${cdiProject.sourceWorkbook} / ${cdiProject.sourceSheet} / ${cdiProject.totalMolds} / lead time ${cdiProject.toolingLeadTimeDays} days`
      : "AI FMEA Prototype Sample";
  const draftRows = useMemo(() => consolidateToolRows(rows), [rows]);

  function getFieldValue(row: NewToolInput, field: EditableFieldKey) {
    if (field === "sizeL") return row.sizeInch?.l ?? "";
    if (field === "sizeW") return row.sizeInch?.w ?? "";
    if (field === "sizeH") return row.sizeInch?.h ?? "";
    if (field === "sizeThk") return row.sizeInch?.thk ?? "";
    return String(row[field as keyof NewToolInput] ?? "");
  }

  function updateRow(id: string, field: EditableFieldKey, value: string) {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.id !== id) return row;
        const nextNumber = value === "" ? undefined : Number(value);

        if (field === "sizeL" || field === "sizeW" || field === "sizeH" || field === "sizeThk") {
          const key = field === "sizeL" ? "l" : field === "sizeW" ? "w" : field === "sizeH" ? "h" : "thk";
          return { ...row, sizeInch: { ...row.sizeInch, [key]: nextNumber } };
        }

        if (
          field === "qtyPerToy" ||
          field === "cavity" ||
          field === "cycleTimeSec" ||
          field === "weeklyCapacityToys" ||
          field === "partWeightG" ||
          field === "slideCount" ||
          field === "machineTon"
        ) {
          return { ...row, [field]: nextNumber ?? 0 };
        }

        return { ...row, [field]: value };
      }),
    );
  }

  function changeSource(nextSource: "cdi" | "demo") {
    setSource(nextSource);
    setRows(nextSource === "cdi" ? cdiNewTools : demoNewTools);
    onSelectedToyChange(nextSource === "cdi" ? "JLK25" : "NEW-DEMO-001");
  }

  useEffect(() => {
    const nextSource = selectedToy === "NEW-DEMO-001" ? "demo" : "cdi";
    setSource(nextSource);
    setRows(nextSource === "cdi" ? cdiNewTools : demoNewTools);
  }, [selectedToy]);

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-steel-200 bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-steel-500">Generate Draft AI FMEA</p>
            <h2 className="mt-1 text-xl font-bold text-steel-950">{projectLabel}</h2>
            <p className="mt-1 text-sm text-steel-500">
              {projectDetail}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={source}
              onChange={(event) => changeSource(event.target.value as "cdi" | "demo")}
              className="h-10 rounded-md border border-steel-300 bg-white px-3 text-sm font-semibold text-steel-700 outline-none focus:border-steel-600 focus:ring-2 focus:ring-steel-200"
            >
              <option value="cdi">JLK25 CDI</option>
              <option value="demo">NEW-DEMO-001 demo</option>
            </select>
            <button
              type="button"
              onClick={() => onGenerate(draftRows)}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-steel-800 px-4 py-2.5 text-sm font-semibold text-white shadow-panel hover:bg-steel-700"
            >
              <WandSparkles size={18} />
              Generate AI Draft FMEA
            </button>
          </div>
        </div>

        {source === "cdi" ? (
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-md bg-steel-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-steel-500">Tool Maker</div>
              <div className="mt-1 font-semibold">{cdiProject.toolMaker}</div>
            </div>
            <div className="rounded-md bg-steel-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-steel-500">Vendor</div>
              <div className="mt-1 font-semibold">{cdiProject.manufacturingVendor}</div>
            </div>
            <div className="rounded-md bg-steel-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-steel-500">Quote Type</div>
              <div className="mt-1 font-semibold">{cdiProject.quoteType}</div>
            </div>
            <div className="rounded-md bg-steel-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-steel-500">Toy Year</div>
              <div className="mt-1 font-semibold">{cdiProject.toyYear}</div>
            </div>
            <div className="rounded-md bg-steel-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-steel-500">Revision</div>
              <div className="mt-1 font-semibold">{cdiProject.revision}</div>
            </div>
            <div className="rounded-md bg-steel-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-steel-500">Draft Groups</div>
              <div className="mt-1 font-semibold">
                {draftRows.length} from {rows.length} CDI rows
              </div>
            </div>
          </div>
        ) : null}

        <div className="compact-scrollbar mt-5 max-h-[460px] overflow-auto rounded-md border border-steel-200">
          <table className="min-w-[2140px] text-left text-sm">
            <thead className="sticky top-0 z-20 border-y border-steel-200 bg-steel-100 text-xs uppercase tracking-wide text-steel-600">
              <tr>
                {editableFields.map((field, index) => (
                  <th
                    key={field.key}
                    className={`px-2 py-2 ${index === 0 ? "sticky left-0 z-30 bg-steel-100" : ""}`}
                  >
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-steel-100">
              {rows.map((row) => (
                <tr key={row.id} className="group hover:bg-steel-50">
                  {editableFields.map((field, index) => (
                    <td
                      key={field.key}
                      className={`px-2 py-2 ${
                        index === 0 ? "sticky left-0 z-10 bg-white shadow-[8px_0_16px_rgba(46,57,65,0.06)] group-hover:bg-steel-50" : ""
                      }`}
                    >
                      <input
                        value={getFieldValue(row, field.key)}
                        type={field.numeric ? "number" : "text"}
                        step={field.numeric ? "0.01" : undefined}
                        onChange={(event) => updateRow(row.id, field.key, event.target.value)}
                        className={`${field.width} rounded-md border border-steel-300 bg-white px-2 py-2 text-sm outline-none focus:border-steel-600 focus:ring-2 focus:ring-steel-200`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {suggestions.length > 0 ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <SummaryTile
            label="Draft FMEA rows"
            value={summary.total}
            onClick={() => setSummaryDrilldown({ title: "Draft FMEA rows", rows: suggestions })}
          />
          <SummaryTile
            label="High confidence"
            value={summary.high}
            onClick={() =>
              setSummaryDrilldown({
                title: "High confidence suggestions",
                rows: suggestions.filter((item) => item.confidence === "High"),
              })
            }
          />
          <SummaryTile
            label="Medium confidence"
            value={summary.medium}
            onClick={() =>
              setSummaryDrilldown({
                title: "Medium confidence suggestions",
                rows: suggestions.filter((item) => item.confidence === "Medium"),
              })
            }
          />
          <SummaryTile
            label="Needs review"
            value={summary.needsReview}
            onClick={() =>
              setSummaryDrilldown({
                title: "Suggestions needing engineer review",
                rows: suggestions.filter((item) => item.reviewStatus === "Needs Engineer Review"),
              })
            }
          />
          <SummaryTile
            label="High RPN"
            value={summary.highRpn}
            onClick={() =>
              setSummaryDrilldown({
                title: "High RPN suggestions",
                rows: suggestions.filter((item) => item.rpn >= 36),
              })
            }
          />
        </section>
      ) : (
        <section className="flex items-start gap-3 rounded-md border border-dashed border-steel-300 bg-white p-4 text-sm text-steel-600">
          <Sparkles className="mt-0.5 text-steel-500" size={18} />
          <div>
            <div className="font-semibold text-steel-800">Draft not generated yet</div>
            <div>Generation will only create suggestions with at least one historical evidence case.</div>
          </div>
        </section>
      )}

      {summary.needsReview > 0 ? (
        <section className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={18} />
          {summary.needsReview} suggestion(s) are marked for engineer review due to low confidence or risky historical notes.
        </section>
      ) : null}

      <FmeaSuggestionTable
        suggestions={suggestions}
        onViewEvidence={onViewEvidence}
        onStatusChange={onStatusChange}
        onRecommendationChange={onRecommendationChange}
        onValidationCommentChange={onValidationCommentChange}
      />
      {summaryDrilldown ? (
        <SuggestionDrilldown
          title={summaryDrilldown.title}
          rows={summaryDrilldown.rows}
          onClose={() => setSummaryDrilldown(null)}
        />
      ) : null}
    </div>
  );
}
