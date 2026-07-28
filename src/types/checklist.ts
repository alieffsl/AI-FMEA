/**
 * Historical FMEA Checklist Types
 */

export interface ChecklistEntry {
  id: string;
  tool_description_normalized: string;
  tool_category: string | null;
  failure_mode: string;
  sub_concern_index: number;
  concern: string;
  recommendation: string;
  supporting_record_count: number;
  supporting_record_ids: string[];
  supporting_failure_ids: number[];
  similarity?: number;
}

export interface ChecklistMatchResponse {
  matches: ChecklistEntry[];
  count: number;
  toolDescription: string;
  failureMode: string;
}

export interface ChecklistStats {
  overview: {
    unique_groups: string;
    total_entries: string;
    total_supporting: string;
    avg_supporting: string;
    min_supporting: number;
    max_supporting: number;
    unique_tools: string;
    unique_failure_modes: string;
  };
  topTools: Array<{
    tool_description_normalized: string;
    tool_category: string;
    entry_count: string;
    total_records: string;
  }>;
  topFailureModes: Array<{
    failure_mode: string;
    entry_count: string;
    total_records: string;
  }>;
}

export interface FailureMode {
  failure_mode: string;
  entry_count: string;
}
