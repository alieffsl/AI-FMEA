import type { ToolRow } from "../types/project";
import type { RagEvidence } from "../types/rag";
import type { HistoricalFmeaCase } from "../data/fmeaMockData";
import type { BaselineStandard } from "../data/baselineStandards";
import { baselineStandards } from "../data/baselineStandards";
import { historicalFmeaCases } from "../data/fmeaMockData";
import { compactText, normalizeToolDescription, normalizeMaterial, normalizeGateType } from "../lib/normalization";

/**
 * Local evidence retrieval for a given tool row.
 * Matches against historical FMEA cases and baseline standards.
 * Designed to be replaceable with vector search in the future.
 */
export function retrieveEvidence(
  toolRow: ToolRow,
  cases: HistoricalFmeaCase[] = historicalFmeaCases,
  standards: BaselineStandard[] = baselineStandards,
): RagEvidence[] {
  const evidence: RagEvidence[] = [];
  const normalizedFamily = normalizeToolDescription(toolRow.toolDescription).normalizedFamily;
  const newMaterial = normalizeMaterial(toolRow.material);
  const newGateType = normalizeGateType(toolRow.gateType);

  // ── Historical FMEA cases ──────────────────────────────────────────────────

  for (const item of cases) {
    let score = 0;
    const reasons: string[] = [];

    if (normalizedFamily === item.normalizedFamily) {
      score += 45;
      reasons.push(`Similar part design: ${normalizedFamily}`);
    }

    if (newMaterial && newMaterial === normalizeMaterial(item.material)) {
      score += 15;
      reasons.push(`Same material: ${newMaterial}`);
    }

    if (newGateType && newGateType === normalizeGateType(item.gateType)) {
      score += 10;
      reasons.push(`Same gate type: ${newGateType}`);
    }

    if (item.status === "Close FS" || item.status === "Close NS") {
      score += 10;
      reasons.push(`Closed finding: ${item.status}`);
    }

    if (score >= 35) {
      evidence.push({
        evidenceId: item.id,
        sourceType: "historical_fmea",
        sourceName: `${item.sourceTag} p${item.sourcePage}`,
        sourceSheet: item.sourceTag,
        sourceRow: item.sourcePage,
        title: `${item.failure} — ${item.toolDescription}`,
        text: `${item.recommendation}. First shot: ${item.firstShotFinding}. ${item.firstShotRecommendation}`,
        imagePaths: [],
        relevanceScore: Math.min(100, score),
        reasons,
      });
    }
  }

  // ── Baseline standards ─────────────────────────────────────────────────────

  const description = compactText(toolRow.toolDescription);
  const familyLower = compactText(normalizedFamily);

  for (const standard of standards) {
    const matched = [standard.toolDescription, ...standard.aliases].some((alias) => {
      const normalizedAlias = compactText(alias);
      return (
        description.includes(normalizedAlias) ||
        normalizedAlias.includes(description) ||
        familyLower.includes(normalizedAlias) ||
        normalizedAlias.includes(familyLower)
      );
    });

    if (matched) {
      for (const check of standard.checklist.filter((c) => c.check.trim())) {
        evidence.push({
          evidenceId: check.id,
          sourceType: "baseline_standard",
          sourceName: `${standard.sourceSheet} — ${standard.toolDescription}`,
          sourceSheet: standard.sourceSheet,
          sourceRow: check.sourceRow,
          title: `Baseline: ${check.check}`,
          text: check.check + (check.remark ? ` (${check.remark})` : ""),
          imagePaths: check.evidenceImageIds ?? [],
          relevanceScore: 70,
          reasons: [`Baseline standard match: ${standard.toolDescription}`],
        });
      }
    }
  }

  // Sort by relevance
  evidence.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return evidence;
}
