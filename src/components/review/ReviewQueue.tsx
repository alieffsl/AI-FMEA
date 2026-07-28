import { ClipboardCheck, MessageSquareText } from "lucide-react";
import type { AiSuggestion, ReviewStatus } from "../../data/fmeaMockData";
import { ConfidenceBadge, RiskBadge, StatusBadge } from "../fmea/FmeaSuggestionTable";

type ReviewQueueProps = {
  suggestions: AiSuggestion[];
  onStatusChange: (id: string, status: ReviewStatus) => void;
  onNotesChange: (id: string, notes: string) => void;
  onViewEvidence: (suggestion: AiSuggestion) => void;
};

const statusOrder: ReviewStatus[] = [
  "Needs Engineer Review",
  "Draft",
  "Accepted",
  "Rejected",
  "Open",
  "Close FS",
  "Close NS",
];

export function ReviewQueue({ suggestions, onStatusChange, onNotesChange, onViewEvidence }: ReviewQueueProps) {
  if (!suggestions.length) {
    return (
      <div className="rounded-md border border-dashed border-steel-300 bg-white p-8 text-center shadow-panel">
        <ClipboardCheck className="mx-auto text-steel-400" size={34} />
        <h2 className="mt-3 text-lg font-bold text-steel-950">Review queue is empty</h2>
        <p className="mt-1 text-sm text-steel-500">Generate the NEW-DEMO-001 draft FMEA to begin review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {statusOrder
        .map((status) => ({
          status,
          items: suggestions.filter((item) => item.reviewStatus === status),
        }))
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.status} className="rounded-md border border-steel-200 bg-white shadow-panel">
            <div className="flex items-center justify-between border-b border-steel-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <StatusBadge status={group.status} />
                <h2 className="font-semibold text-steel-950">{group.items.length} item(s)</h2>
              </div>
            </div>

            <div className="divide-y divide-steel-100">
              {group.items.map((suggestion) => (
                <article key={suggestion.id} className="p-4">
                  <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-steel-950">{suggestion.toolNo}</span>
                        <span className="text-steel-500">{suggestion.toolDescription}</span>
                        <ConfidenceBadge confidence={suggestion.confidence} />
                        <RiskBadge rpn={suggestion.rpn} />
                      </div>
                      <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-steel-500">
                        Potential failure
                      </div>
                      <h3 className="mt-1 text-lg font-bold text-steel-950">{suggestion.failure}</h3>
                      <p className="mt-2 text-sm leading-6 text-steel-700">{suggestion.recommendation}</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="rounded-md bg-steel-50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-steel-500">
                            RAG recommended actions
                          </div>
                          <div className="mt-2 space-y-1 text-xs leading-5 text-steel-700">
                            {suggestion.recommendedActions.slice(0, 3).map((action) => (
                              <div key={action}>{action}</div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-md bg-blue-50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                            AI training comment
                          </div>
                          <div className="mt-2 text-xs leading-5 text-blue-900">
                            {suggestion.validationComment || "No training comment added yet."}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 text-xs text-steel-500">
                        Evidence: {suggestion.evidence.map((item) => `${item.sourceTag} p${item.sourcePage}`).join(", ")}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => onStatusChange(suggestion.id, "Accepted")}
                          className="rounded-md border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => onStatusChange(suggestion.id, "Rejected")}
                          className="rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => onStatusChange(suggestion.id, "Needs Engineer Review")}
                          className="rounded-md border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-50"
                        >
                          Review
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => onViewEvidence(suggestion)}
                        className="w-full rounded-md border border-steel-300 px-3 py-2 text-sm font-semibold text-steel-700 hover:bg-steel-100"
                      >
                        View evidence
                      </button>

                      <label className="block text-sm">
                        <span className="mb-1 flex items-center gap-2 font-medium text-steel-600">
                          <MessageSquareText size={16} />
                          Reviewer notes
                        </span>
                        <textarea
                          value={suggestion.reviewerNotes}
                          onChange={(event) => onNotesChange(suggestion.id, event.target.value)}
                          className="min-h-24 w-full rounded-md border border-steel-300 p-2 text-sm outline-none focus:border-steel-600 focus:ring-2 focus:ring-steel-200"
                          placeholder="Add review comment..."
                        />
                      </label>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
