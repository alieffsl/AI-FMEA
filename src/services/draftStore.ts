import type { ProjectMetadata } from "../types/project";
import type { FmeaDraftRow } from "../types/fmea";
import { fetchJson } from "../lib/http";

/**
 * Persistence for generated drafts.
 *
 * A generated draft used to exist only in React state, so a refresh or a stray
 * navigation destroyed the session's work with no way to recover it. These
 * calls back `fmea_draft` / `fmea_draft_row` (migration/03_create_draft_tables.sql).
 */

export type SavedDraftSummary = {
  id: string;
  projectName: string | null;
  sourceFilename: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  rowCount: number;
};

export type LoadedDraft = {
  id: string;
  projectName: string | null;
  sourceFilename: string | null;
  metadata: ProjectMetadata;
  createdAt: string;
  updatedAt: string;
  drafts: FmeaDraftRow[];
};

/** Persist a generated draft. Returns the new draft id. */
export async function saveDraft(
  metadata: ProjectMetadata,
  drafts: FmeaDraftRow[],
  draftId?: string | null,
): Promise<string> {
  const data = await fetchJson<{ id: string }>("/api/fmea/draft", {
    method: "POST",
    body: { metadata, drafts, draftId },
    // Saving writes every row, so allow longer than a read.
    timeoutMs: 45000,
  });
  return data.id;
}

/** Load a previously saved draft by id. */
export async function loadDraft(id: string): Promise<LoadedDraft> {
  return fetchJson<LoadedDraft>(`/api/fmea/draft/${encodeURIComponent(id)}`, {
    timeoutMs: 10000,
  });
}

/** List saved drafts, most recently updated first. */
export async function listDrafts(): Promise<SavedDraftSummary[]> {
  const data = await fetchJson<{ drafts?: SavedDraftSummary[] }>("/api/fmea/drafts");
  return data.drafts ?? [];
}
