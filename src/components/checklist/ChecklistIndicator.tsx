/**
 * Inline Checklist Indicator
 * 
 * Small badge that shows when historical checklist entries exist for a row.
 * Can be expanded to show the full checklist.
 */

import { useState } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { HistoricalChecklist } from './HistoricalChecklist';

interface ChecklistIndicatorProps {
  toolDescription: string;
  failureMode: string;
}

export function ChecklistIndicator({ toolDescription, failureMode }: ChecklistIndicatorProps) {
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);

  // Don't show anything until we know there are matches
  if (matchCount === null || matchCount === 0) {
    return (
      <div className="hidden">
        <HistoricalChecklist
          toolDescription={toolDescription}
          failureMode={failureMode}
          onMatchesFound={setMatchCount}
        />
      </div>
    );
  }

  if (showChecklist) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Historical Checklist</h3>
            <button
              onClick={() => setShowChecklist(false)}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
          <div className="p-4">
            <HistoricalChecklist
              toolDescription={toolDescription}
              failureMode={failureMode}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowChecklist(true)}
      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs font-medium transition-colors"
      title={`View ${matchCount} historical checklist ${matchCount === 1 ? 'entry' : 'entries'}`}
    >
      <Lightbulb className="h-3 w-3" />
      {matchCount} {matchCount === 1 ? 'tip' : 'tips'}
    </button>
  );
}
