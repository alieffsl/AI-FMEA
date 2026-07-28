import { useMemo, useState } from "react";
import { Clipboard, Download, Printer } from "lucide-react";
import type { AiSuggestion } from "../../data/fmeaMockData";
import { StatusBadge } from "../fmea/FmeaSuggestionTable";

type ExportPreviewProps = {
  suggestions: AiSuggestion[];
};

const headers = [
  "No.",
  "Tool No.",
  "Tool Description",
  "Potential Failure",
  "RAG Recommendation",
  "Recommended Actions",
  "AI Training Comment",
  "First Shot",
  "First Shot Recommendation",
  "Next Shot Recommendation",
  "Severity",
  "Occurrence",
  "Detection",
  "RPN",
  "Status",
  "Evidence",
];

function escapeCsv(value: string | number) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildRows(suggestions: AiSuggestion[]) {
  return suggestions.map((item, index) => [
    index + 1,
    item.toolNo,
    item.toolDescription,
    item.failure,
    item.recommendation,
    item.recommendedActions.join(" | "),
    item.validationComment,
    item.firstShot,
    item.firstShotRecommendation,
    item.nextShotRecommendation,
    item.severity,
    item.occurrence,
    item.detection,
    item.rpn,
    item.reviewStatus,
    item.evidence.map((evidence) => `${evidence.sourceTag} p${evidence.sourcePage}`).join("; "),
  ]);
}

export function ExportPreview({ suggestions }: ExportPreviewProps) {
  const [copied, setCopied] = useState(false);
  const rows = useMemo(() => buildRows(suggestions), [suggestions]);
  const csv = useMemo(() => [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n"), [rows]);
  const tsv = useMemo(() => [headers, ...rows].map((row) => row.join("\t")).join("\n"), [rows]);
  const exportProject = suggestions[0]
    ? `${suggestions[0].projectCode} - ${suggestions[0].projectName}`
    : "Draft FMEA";

  function exportCsv() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${suggestions[0]?.projectCode ?? "draft"}-ai-fmea-draft.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function copyTable() {
    await navigator.clipboard.writeText(tsv);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-5">
      <section className="no-print flex flex-col gap-3 rounded-md border border-steel-200 bg-white p-4 shadow-panel md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-bold text-steel-950">Export Preview</h2>
          <p className="mt-1 text-sm text-steel-500">Current session suggestions formatted as an FMEA export table.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={!suggestions.length}
            className="inline-flex items-center gap-2 rounded-md bg-steel-800 px-3 py-2 text-sm font-semibold text-white hover:bg-steel-700 disabled:cursor-not-allowed disabled:bg-steel-300"
          >
            <Download size={17} />
            Export CSV
          </button>
          <button
            type="button"
            onClick={copyTable}
            disabled={!suggestions.length}
            className="inline-flex items-center gap-2 rounded-md border border-steel-300 px-3 py-2 text-sm font-semibold text-steel-700 hover:bg-steel-100 disabled:cursor-not-allowed disabled:text-steel-300"
          >
            <Clipboard size={17} />
            {copied ? "Copied" : "Copy table"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!suggestions.length}
            className="inline-flex items-center gap-2 rounded-md border border-steel-300 px-3 py-2 text-sm font-semibold text-steel-700 hover:bg-steel-100 disabled:cursor-not-allowed disabled:text-steel-300"
          >
            <Printer size={17} />
            Print preview
          </button>
        </div>
      </section>

      <section className="print-full rounded-md border border-steel-200 bg-white shadow-panel">
        <div className="border-b border-steel-200 px-4 py-3">
          <h3 className="font-semibold text-steel-950">{exportProject}</h3>
        </div>
        {suggestions.length ? (
          <div className="compact-scrollbar max-h-[70vh] overflow-auto">
            <table className="min-w-[1900px] divide-y divide-steel-200 text-left text-sm">
              <thead className="sticky top-0 bg-steel-100 text-xs uppercase tracking-wide text-steel-600">
                <tr>
                  {headers.map((header) => (
                    <th key={header} className="px-3 py-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-steel-100">
                {suggestions.map((item, index) => (
                  <tr key={item.id} className="align-top hover:bg-steel-50">
                    <td className="px-3 py-3">{index + 1}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold">{item.toolNo}</td>
                    <td className="px-3 py-3">{item.toolDescription}</td>
                    <td className="px-3 py-3 font-medium text-steel-950">{item.failure}</td>
                    <td className="min-w-[260px] px-3 py-3 text-steel-700">{item.recommendation}</td>
                    <td className="min-w-[280px] px-3 py-3 text-steel-700">
                      {item.recommendedActions.slice(0, 4).join(" | ")}
                    </td>
                    <td className="min-w-[280px] px-3 py-3 text-steel-700">{item.validationComment}</td>
                    <td className="min-w-[220px] px-3 py-3 text-steel-700">{item.firstShot}</td>
                    <td className="min-w-[220px] px-3 py-3 text-steel-700">{item.firstShotRecommendation}</td>
                    <td className="min-w-[220px] px-3 py-3 text-steel-700">{item.nextShotRecommendation}</td>
                    <td className="px-3 py-3">{item.severity}</td>
                    <td className="px-3 py-3">{item.occurrence}</td>
                    <td className="px-3 py-3">{item.detection}</td>
                    <td className="px-3 py-3 font-semibold">{item.rpn}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <StatusBadge status={item.reviewStatus} />
                    </td>
                    <td className="min-w-[180px] px-3 py-3 text-steel-600">
                      {item.evidence.map((evidence) => `${evidence.sourceTag} p${evidence.sourcePage}`).join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-steel-500">Generate a draft FMEA before exporting.</div>
        )}
      </section>
    </div>
  );
}
