import { X } from "lucide-react";
import type { AiSuggestion } from "../../data/fmeaMockData";
import { ConfidenceBadge, RiskBadge, StatusBadge } from "./FmeaSuggestionTable";

type EvidenceDrawerProps = {
  suggestion: AiSuggestion | null;
  onClose: () => void;
};

export function EvidenceDrawer({ suggestion, onClose }: EvidenceDrawerProps) {
  if (!suggestion) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close evidence drawer overlay"
        className="absolute inset-0 bg-steel-950/35"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col bg-white shadow-2xl">
        <header className="border-b border-steel-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-steel-500">
                {suggestion.toolNo} - {suggestion.toolDescription}
              </p>
              <h2 className="mt-1 text-xl font-bold text-steel-950">{suggestion.failure}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <RiskBadge rpn={suggestion.rpn} />
                <ConfidenceBadge confidence={suggestion.confidence} />
                <StatusBadge status={suggestion.reviewStatus} />
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-steel-200 p-2 text-steel-700 hover:bg-steel-100"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="compact-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
          <section className="rounded-md border border-steel-200 bg-steel-50 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-steel-500">RAG recommendation</h3>
            <p className="mt-2 text-sm leading-6 text-steel-800">{suggestion.recommendation}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-steel-500">S/O/D</dt>
                <dd className="font-semibold">
                  {suggestion.severity}/{suggestion.occurrence}/{suggestion.detection}
                </dd>
              </div>
              <div>
                <dt className="text-steel-500">RPN</dt>
                <dd className="font-semibold">{suggestion.rpn}</dd>
              </div>
              <div>
                <dt className="text-steel-500">Action family</dt>
                <dd className="font-semibold">{suggestion.actionFamily}</dd>
              </div>
            </dl>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-steel-200 bg-white p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-steel-500">Recommended actions from RAG</h3>
              <div className="mt-3 space-y-2">
                {suggestion.recommendedActions.map((action) => (
                  <div key={action} className="rounded-md bg-steel-50 p-2 text-sm leading-6 text-steel-700">
                    {action}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-steel-200 bg-white p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-steel-500">AI training comment</h3>
              <div className="mt-3 space-y-2">
                <div className="rounded-md bg-blue-50 p-3 text-sm leading-6 text-blue-900">
                  {suggestion.validationComment || "No training comment added yet."}
                </div>
                <div className="text-xs font-semibold uppercase tracking-wide text-steel-500">Generated check prompts</div>
                {suggestion.validations.slice(0, 4).map((validation) => (
                  <div key={validation} className="rounded-md bg-steel-50 p-2 text-xs leading-5 text-steel-700">
                    {validation}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {suggestion.baselineStandards.length ? (
            <section className="rounded-md border border-steel-200 bg-white p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-steel-500">Baseline standards matched</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestion.baselineStandards.map((standard) => (
                  <span
                    key={standard.standardId}
                    className="rounded-full bg-steel-100 px-2 py-1 text-xs font-semibold text-steel-700"
                  >
                    {standard.toolDescription} / {standard.sourceSheet} / {standard.checklistCount} checks
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {suggestion.evidence.map((evidence) => (
            <article key={evidence.id} className="rounded-md border border-steel-200 bg-white p-4 shadow-panel">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="font-semibold text-steel-950">
                    {evidence.projectCode} - {evidence.projectName}
                  </h3>
                  <p className="mt-1 text-sm text-steel-600">
                    Source tool: {evidence.toolNo}, {evidence.toolDescription}
                  </p>
                  <p className="text-sm text-steel-600">
                    Source page tag: {evidence.sourceTag} p{evidence.sourcePage}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={evidence.status} />
                  <span className="rounded-full bg-steel-100 px-2 py-1 text-xs font-semibold text-steel-700">
                    Score {evidence.similarityScore}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-[1fr_220px]">
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="font-semibold text-steel-700">Historical failure</div>
                    <div className="text-steel-600">{evidence.failure}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-steel-700">Historical recommendation</div>
                    <div className="text-steel-600">{evidence.recommendation}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-steel-700">First Shot finding</div>
                    <div className="text-steel-600">{evidence.firstShotFinding}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-steel-700">S/O/D/RPN</div>
                    <div className="text-steel-600">
                      {evidence.severity}/{evidence.occurrence}/{evidence.detection}/{evidence.rpn}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-steel-700">Similarity reasons</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {evidence.similarityReasons.map((reason) => (
                        <span key={reason} className="rounded-full bg-steel-100 px-2 py-1 text-xs text-steel-700">
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed border-steel-300 bg-steel-50 p-4 text-center text-sm font-medium text-steel-500">
                  FMEA image/crop placeholder - source {evidence.sourceTag} p{evidence.sourcePage}
                </div>
              </div>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}
