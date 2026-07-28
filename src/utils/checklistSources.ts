import type { FmeaDraftRow } from "../types/fmea";

export type ChecklistEntry = NonNullable<FmeaDraftRow["checklistEntries"]>[number];
export type ChecklistSourceKind =
  | "historical_fmea"
  | "product_standard"
  | "baseline_standard";

export const CHECKLIST_SOURCE_LABELS: Record<ChecklistSourceKind, string> = {
  historical_fmea: "Previous FMEA",
  product_standard: "MEC Product Standard",
  baseline_standard: "Baseline Tooling Standard",
};

export function getChecklistSourceKinds(
  entry: ChecklistEntry,
): ChecklistSourceKind[] {
  const sources = new Set<ChecklistSourceKind>(entry.source_types || []);

  for (const reference of entry.supporting_standard_refs || []) {
    sources.add(reference.source_type);
  }

  // Older/local entries predate source_types and are historical by definition.
  if (sources.size === 0) sources.add("historical_fmea");

  return [
    "historical_fmea",
    "product_standard",
    "baseline_standard",
  ].filter((source): source is ChecklistSourceKind => sources.has(source as ChecklistSourceKind));
}

export function getChecklistSourceLabel(entry: ChecklistEntry): string {
  return getChecklistSourceKinds(entry)
    .map((source) => CHECKLIST_SOURCE_LABELS[source])
    .join(" + ");
}

export function getStandardSourceTitles(entry: ChecklistEntry): string[] {
  return Array.from(
    new Set(
      (entry.supporting_standard_refs || [])
        .map((reference) => reference.title?.trim())
        .filter((title): title is string => Boolean(title)),
    ),
  );
}

export function countChecklistSources(entries: ChecklistEntry[]) {
  return entries.reduce(
    (counts, entry) => {
      for (const source of getChecklistSourceKinds(entry)) counts[source] += 1;
      return counts;
    },
    {
      historical_fmea: 0,
      product_standard: 0,
      baseline_standard: 0,
    } satisfies Record<ChecklistSourceKind, number>,
  );
}
