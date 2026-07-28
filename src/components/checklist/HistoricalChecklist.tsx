/**
 * Historical FMEA Checklist Component
 * 
 * Displays pre-computed checklist entries matched by tool description and failure mode.
 * Integrates with Generate Draft page to show relevant concerns and recommendations.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Lightbulb, Users, ExternalLink } from 'lucide-react';
import type { ChecklistEntry } from '../../types/checklist';
import { matchChecklist } from '../../services/checklistService';

interface HistoricalChecklistProps {
  toolDescription: string;
  failureMode: string;
  onMatchesFound?: (count: number) => void;
}

export function HistoricalChecklist({ 
  toolDescription, 
  failureMode,
  onMatchesFound 
}: HistoricalChecklistProps) {
  const [matches, setMatches] = useState<ChecklistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!toolDescription || !failureMode) {
      setMatches([]);
      return;
    }

    const fetchMatches = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const response = await matchChecklist(toolDescription, failureMode);
        setMatches(response.matches);
        onMatchesFound?.(response.matches.length);
      } catch (err) {
        console.error('[Checklist] Error fetching matches:', err);
        setError(err instanceof Error ? err.message : 'Failed to load checklist');
        setMatches([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMatches();
  }, [toolDescription, failureMode, onMatchesFound]);

  if (isLoading) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-blue-700">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent" />
          <span className="text-sm font-medium">Loading historical checklist...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-800">Checklist Unavailable</p>
            <p className="text-xs text-yellow-700 mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (matches.length === 0) {
    return null; // Don't show anything if no matches
  }

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-blue-100/50 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-blue-600" />
          <span className="font-semibold text-blue-900">
            Historical Checklist
          </span>
          <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full font-medium">
            {matches.length} {matches.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        <svg
          className={`h-5 w-5 text-blue-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-blue-700">
            Based on {matches.reduce((sum, m) => sum + m.supporting_record_count, 0)} historical records
          </p>

          {/* Checklist Entries */}
          <div className="space-y-2">
            {matches.map((entry, index) => (
              <ChecklistEntryCard key={entry.id} entry={entry} index={index} />
            ))}
          </div>

          {/* Footer */}
          <div className="pt-2 border-t border-blue-200">
            <p className="text-xs text-blue-600 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              AI-consolidated from similar past failures
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

interface ChecklistEntryCardProps {
  entry: ChecklistEntry;
  index: number;
}

function ChecklistEntryCard({ entry, index }: ChecklistEntryCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="bg-white border border-blue-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full px-3 py-2.5 text-left hover:bg-blue-50 transition-colors"
      >
        <div className="flex items-start gap-2">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center mt-0.5">
            {index + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 leading-snug">
              {entry.concern}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                <Users className="h-3 w-3" />
                {entry.supporting_record_count} {entry.supporting_record_count === 1 ? 'record' : 'records'}
              </span>
              {entry.similarity !== undefined && entry.similarity < 1 && (
                <span className="text-xs text-gray-500">
                  {Math.round(entry.similarity * 100)}% match
                </span>
              )}
            </div>
          </div>
          <svg
            className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${showDetails ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded Details */}
      {showDetails && (
        <div className="px-3 pb-3 pt-0 border-t border-blue-100 bg-blue-50/30">
          <div className="mt-2 space-y-2">
            {/* Recommendation */}
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Recommended Action:
              </p>
              <p className="text-sm text-gray-800 bg-white rounded px-2 py-1.5 border border-green-200">
                {entry.recommendation}
              </p>
            </div>

            {/* Supporting Records */}
            <div>
              <p className="text-xs text-gray-600 flex items-center gap-1">
                <ExternalLink className="h-3 w-3" />
                Supporting Failure IDs: {entry.supporting_failure_ids.slice(0, 5).join(', ')}
                {entry.supporting_failure_ids.length > 5 && ` +${entry.supporting_failure_ids.length - 5} more`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
