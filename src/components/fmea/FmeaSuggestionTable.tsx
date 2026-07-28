import { useState } from "react";
import { Check, Eye, Pencil, Save, X } from "lucide-react";
import type { AiSuggestion, ReviewStatus } from "../../data/fmeaMockData";
import { getRpnBucket } from "../../lib/normalization";

type FmeaSuggestionTableProps = {
  suggestions: AiSuggestion[];
  onViewEvidence: (suggestion: AiSuggestion) => void;
  onStatusChange: (id: string, status: ReviewStatus) => void;
  onRecommendationChange: (id: string, recommendation: string) => void;
  onValidationCommentChange: (id: string, validationComment: string) => void;
};

const badgeBase = "inline-flex min-w-fit items-center rounded-full px-2 py-1 text-xs font-semibold";

export function RiskBadge({ rpn }: { rpn: number }) {
  const bucket = getRpnBucket(rpn);
  const styles: Record<typeof bucket, string> = {
    Critical: "bg-red-100 text-red-800",
    High: "bg-orange-100 text-orange-800",
    Medium: "bg-amber-100 text-amber-800",
    Low: "bg-emerald-100 text-emerald-800",
  };

  return <span className={`${badgeBase} ${styles[bucket]}`}>{bucket}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: AiSuggestion["confidence"] }) {
  const styles = {
    High: "bg-emerald-100 text-emerald-800",
    Medium: "bg-blue-100 text-blue-800",
    Low: "bg-slate-200 text-slate-700",
  };

  return <span className={`${badgeBase} ${styles[confidence]}`}>{confidence}</span>;
}

export function StatusBadge({ status }: { status: ReviewStatus }) {
  const styles: Record<ReviewStatus, string> = {
    Draft: "bg-steel-100 text-steel-800",
    Accepted: "bg-emerald-100 text-emerald-800",
    Rejected: "bg-red-100 text-red-800",
    "Needs Engineer Review": "bg-amber-100 text-amber-900",
    Open: "bg-blue-100 text-blue-800",
    "Close FS": "bg-green-100 text-green-800",
    "Close NS": "bg-teal-100 text-teal-800",
  };

  return <span className={`${badgeBase} ${styles[status]}`}>{status}</span>;
}

export function FmeaSuggestionTable({
  suggestions,
  onViewEvidence,
  onStatusChange,
  onRecommendationChange,
  onValidationCommentChange,
}: FmeaSuggestionTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRecommendation, setDraftRecommendation] = useState("");

  function startEdit(suggestion: AiSuggestion) {
    setEditingId(suggestion.id);
    setDraftRecommendation(suggestion.recommendation);
  }

  function saveEdit(id: string) {
    onRecommendationChange(id, draftRecommendation);
    setEditingId(null);
    setDraftRecommendation("");
  }

  if (!suggestions.length) {
    return (
      <div className="rounded-md border border-dashed border-steel-300 bg-white p-8 text-center text-sm text-steel-500">
        Generate a draft FMEA to populate evidence-backed AI suggestions.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-steel-200 bg-white shadow-panel">
      <div className="compact-scrollbar max-h-[70vh] overflow-auto">
        <table className="min-w-[1680px] divide-y divide-steel-200 text-left text-sm">
          <thead className="sticky top-0 z-20 bg-steel-100 text-xs uppercase tracking-wide text-steel-600">
            <tr>
              <th className="sticky left-0 z-30 bg-steel-100 px-3 py-3">Tool No.</th>
              <th className="px-3 py-3">Tool Description</th>
              <th className="px-3 py-3">Potential Failure</th>
              <th className="px-3 py-3">RAG Recommendation</th>
              <th className="px-3 py-3">Recommended Actions</th>
              <th className="px-3 py-3">AI Training Comment</th>
              <th className="px-3 py-3">S/O/D</th>
              <th className="px-3 py-3">RPN</th>
              <th className="px-3 py-3">Confidence</th>
              <th className="px-3 py-3">Evidence</th>
              <th className="px-3 py-3">Review Status</th>
              <th className="sticky right-0 z-30 bg-steel-100 px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-100">
            {suggestions.map((suggestion) => {
              const isEditing = editingId === suggestion.id;

              return (
                <tr key={suggestion.id} className="group align-top hover:bg-steel-50">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-3 font-semibold text-steel-950 group-hover:bg-steel-50">
                    {suggestion.toolNo}
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-steel-900">{suggestion.toolDescription}</div>
                    <div className="text-xs text-steel-500">
                      {suggestion.material} / {suggestion.gateType}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-medium text-steel-950">{suggestion.failure}</td>
                  <td className="min-w-[280px] px-3 py-3">
                    {isEditing ? (
                      <textarea
                        value={draftRecommendation}
                        onChange={(event) => setDraftRecommendation(event.target.value)}
                        className="min-h-24 w-full rounded-md border border-steel-300 bg-white p-2 text-sm outline-none focus:border-steel-600 focus:ring-2 focus:ring-steel-200"
                      />
                    ) : (
                      <div>
                        <span className="text-steel-700">{suggestion.recommendation}</span>
                        {suggestion.imageUrl && (
                          <div className="mt-2">
                            <img src={suggestion.imageUrl} alt="Recommendation" className="max-h-48 rounded-md border border-steel-200 shadow-sm object-contain" />
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1">
                          <span className="rounded-full bg-steel-100 px-2 py-1 text-[11px] font-semibold text-steel-700">
                            FMEA history {suggestion.evidence.length}
                          </span>
                          {suggestion.baselineStandards.length ? (
                            <span className="rounded-full bg-blue-100 px-2 py-1 text-[11px] font-semibold text-blue-800">
                              Baseline standards {suggestion.baselineStandards.length}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="min-w-[320px] px-3 py-3">
                    {suggestion.recommendedActions.length ? (
                      <div className="space-y-2">
                        {suggestion.recommendedActions.slice(0, 3).map((action) => (
                          <div key={action} className="rounded-md bg-steel-50 p-2 text-xs leading-5 text-steel-700">
                            {action}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-steel-500">No separate support action generated.</span>
                    )}
                  </td>
                  <td className="min-w-[280px] px-3 py-3">
                    <textarea
                      value={suggestion.validationComment}
                      onChange={(event) => onValidationCommentChange(suggestion.id, event.target.value)}
                      className="min-h-24 w-full rounded-md border border-steel-300 bg-white p-2 text-xs leading-5 outline-none focus:border-steel-600 focus:ring-2 focus:ring-steel-200"
                      placeholder="Add validation notes or AI training feedback..."
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {suggestion.severity}/{suggestion.occurrence}/{suggestion.detection}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="flex items-center gap-2">
                      <strong>{suggestion.rpn}</strong>
                      <RiskBadge rpn={suggestion.rpn} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="space-y-1">
                      <ConfidenceBadge confidence={suggestion.confidence} />
                      <div className="text-xs text-steel-500">{suggestion.confidenceScore}% match</div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">{suggestion.evidence.length}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <StatusBadge status={suggestion.reviewStatus} />
                  </td>
                  <td className="sticky right-0 z-10 whitespace-nowrap bg-white px-3 py-3 shadow-[-8px_0_16px_rgba(46,57,65,0.08)] group-hover:bg-steel-50">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="View Evidence"
                        onClick={() => onViewEvidence(suggestion)}
                        className="rounded-md border border-steel-200 p-2 text-steel-700 hover:bg-steel-100"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        type="button"
                        title="Accept"
                        onClick={() => onStatusChange(suggestion.id, "Accepted")}
                        className="rounded-md border border-emerald-200 p-2 text-emerald-700 hover:bg-emerald-50"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        type="button"
                        title="Reject"
                        onClick={() => onStatusChange(suggestion.id, "Rejected")}
                        className="rounded-md border border-red-200 p-2 text-red-700 hover:bg-red-50"
                      >
                        <X size={16} />
                      </button>
                      {isEditing ? (
                        <button
                          type="button"
                          title="Save"
                          onClick={() => saveEdit(suggestion.id)}
                          className="rounded-md border border-steel-700 bg-steel-800 p-2 text-white hover:bg-steel-700"
                        >
                          <Save size={16} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => startEdit(suggestion)}
                          className="rounded-md border border-steel-200 p-2 text-steel-700 hover:bg-steel-100"
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
