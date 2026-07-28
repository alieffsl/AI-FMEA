/**
 * Historical FMEA Checklist API Service
 */

import type { ChecklistMatchResponse, ChecklistStats, FailureMode } from '../types/checklist';

const API_BASE = '/api/checklist';

/**
 * Match checklist entries for a tool + failure mode
 */
export async function matchChecklist(
  toolDescription: string,
  failureMode: string,
  threshold: number = 0.75,
  limit: number = 10
): Promise<ChecklistMatchResponse> {
  const params = new URLSearchParams({
    toolDescription,
    failureMode,
    threshold: threshold.toString(),
    limit: limit.toString(),
  });

  const response = await fetch(`${API_BASE}/match?${params}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch checklist matches: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Batch match for multiple tools
 */
export async function matchChecklistBatch(
  tools: Array<{ toolDescription: string; failureMode: string }>,
  threshold: number = 0.75,
  maxResultsPerTool: number = 5
): Promise<Record<string, any[]>> {
  const response = await fetch(`${API_BASE}/match-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tools, threshold, maxResultsPerTool }),
  });

  if (!response.ok) {
    throw new Error(`Failed to batch match checklists: ${response.statusText}`);
  }

  const data = await response.json();
  return data.results;
}

/**
 * Get checklist system statistics
 */
export async function getChecklistStats(): Promise<ChecklistStats> {
  const response = await fetch(`${API_BASE}/stats`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch checklist stats: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get all available failure modes
 */
export async function getFailureModes(): Promise<FailureMode[]> {
  const response = await fetch(`${API_BASE}/failure-modes`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch failure modes: ${response.statusText}`);
  }

  const data = await response.json();
  return data.failureModes;
}
