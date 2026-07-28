import type {
  AiSuggestion,
  EvidenceCase,
  FailureTaxonomyItem,
  HistoricalFmeaCase,
  NewToolInput,
  ReviewStatus,
} from "../data/fmeaMockData";
import type { BaselineStandard } from "../data/baselineStandards";
import { baselineStandards } from "../data/baselineStandards";
import { compactText, normalizeGateType, normalizeMaterial, normalizeToolDescription } from "./normalization";

export type ScoreResult = {
  score: number;
  reasons: string[];
  penalties: string[];
};

type ScoredCase = HistoricalFmeaCase & ScoreResult;

const REVIEW_TRIGGER_SCORE = 55;
const DIMENSION_OR_ACTION_DETAIL =
  /(\d+(\.\d+)?\s?(mm|degree|degrees|deg|%|percent)|\bR\d+(\.\d+)?\b|\bOD\b|\bID\b|\bincrease\b|\badd\b|\bmove\b|\bshift\b|\btighten\b|\breduce\b|\bwiden\b|\bpolish\b)/i;
const REJECTION_OR_BREAK_RISK =
  /(rejected|impossible|break-risk|break risk|supplier comment|supplier proposed no change|not feasible)/i;

export function buildFailureCountsByFamily(historicalCases: HistoricalFmeaCase[]) {
  return historicalCases.reduce<Record<string, Record<string, number>>>((acc, item) => {
    acc[item.normalizedFamily] ??= {};
    acc[item.normalizedFamily][item.failure] = (acc[item.normalizedFamily][item.failure] ?? 0) + 1;
    return acc;
  }, {});
}

export function getTaxonomyForFailure(
  failure: string,
  failureTaxonomy: FailureTaxonomyItem[],
): FailureTaxonomyItem | undefined {
  return failureTaxonomy.find((item) => item.failure.toLowerCase() === failure.toLowerCase());
}

export function calculateRpn(severity?: number, occurrence?: number, detection?: number): number {
  if (
    typeof severity !== "number" ||
    typeof occurrence !== "number" ||
    typeof detection !== "number" ||
    Number.isNaN(severity) ||
    Number.isNaN(occurrence) ||
    Number.isNaN(detection)
  ) {
    return 0;
  }

  return severity * occurrence * detection;
}

export function getConfidence(score: number): "High" | "Medium" | "Low" {
  if (score >= 80) return "High";
  if (score >= 55) return "Medium";
  return "Low";
}

export function getMatchingBaselineStandards(newTool: NewToolInput, standards: BaselineStandard[] = baselineStandards) {
  const description = compactText(newTool.toolDescription);
  const normalizedFamily = compactText(normalizeToolDescription(newTool.toolDescription).normalizedFamily);

  return standards.filter((standard) =>
    [standard.toolDescription, ...standard.aliases].some((alias) => {
      const normalizedAlias = compactText(alias);
      return (
        description.includes(normalizedAlias) ||
        normalizedAlias.includes(description) ||
        normalizedFamily.includes(normalizedAlias) ||
        normalizedAlias.includes(normalizedFamily)
      );
    }),
  );
}

function uniqueText(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function sumNumbers(values: Array<number | undefined>) {
  return Number(values.reduce<number>((sum, value) => sum + (Number(value) || 0), 0).toFixed(2));
}

function maxNumber(values: Array<number | undefined>) {
  const numericValues = values.filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
  return numericValues.length ? Math.max(...numericValues) : undefined;
}

export function consolidateToolRows(rows: NewToolInput[]): NewToolInput[] {
  const groups = new Map<string, NewToolInput[]>();

  rows.forEach((row) => {
    const key = [
      row.projectCode,
      row.toolNo,
      row.material.trim().toLowerCase(),
      row.gateType.trim().toLowerCase(),
      row.moldMaterial.trim().toLowerCase(),
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });

  return Array.from(groups.values()).map((group) => {
    if (group.length === 1) return group[0];

    const first = group[0];
    const sourceRows = group.map((row) => row.cdiSource?.row).filter((row): row is number => typeof row === "number");
    const sizeL = maxNumber(group.map((row) => row.sizeInch?.l));
    const sizeW = maxNumber(group.map((row) => row.sizeInch?.w));
    const sizeH = maxNumber(group.map((row) => row.sizeInch?.h));
    const sizeThk = maxNumber(group.map((row) => row.sizeInch?.thk));
    const hasSize = [sizeL, sizeW, sizeH, sizeThk].some((value) => typeof value === "number");

    return {
      ...first,
      id: group.map((row) => row.id).join("__"),
      refPartNumber: uniqueText(group.map((row) => row.refPartNumber)).join(", "),
      toolDescription: uniqueText(group.map((row) => row.toolDescription)).join(" / "),
      qtyPerToy: sumNumbers(group.map((row) => row.qtyPerToy)),
      cavity: maxNumber(group.map((row) => row.cavity)) ?? first.cavity,
      cycleTimeSec: maxNumber(group.map((row) => row.cycleTimeSec)),
      weeklyCapacityToys: maxNumber(group.map((row) => row.weeklyCapacityToys)),
      partWeightG: sumNumbers(group.map((row) => row.partWeightG)),
      toolAid: uniqueText(group.map((row) => row.toolAid)).join(", "),
      toolBuild: uniqueText(group.map((row) => row.toolBuild)).join(", "),
      sizeInch: hasSize
        ? {
            l: sizeL,
            w: sizeW,
            h: sizeH,
            thk: sizeThk,
          }
        : first.sizeInch,
      slideCount: maxNumber(group.map((row) => row.slideCount)),
      color: uniqueText(group.map((row) => row.color)).join(", "),
      machineTon: maxNumber(group.map((row) => row.machineTon)),
      decoration: uniqueText(group.map((row) => row.decoration)).join("; "),
      assembly: uniqueText(group.map((row) => row.assembly)).join("; "),
      cdiSource: first.cdiSource
        ? {
            ...first.cdiSource,
            row: sourceRows.length ? Math.min(...sourceRows) : first.cdiSource.row,
          }
        : first.cdiSource,
    };
  });
}

function buildRecommendedActions(
  recommendation: string,
  evidence: ScoredCase[],
  matchingStandards: BaselineStandard[],
): string[] {
  const actions = [
    ...evidence
      .filter((item) => item.firstShotRecommendation)
      .slice(0, 2)
      .map((item) => `Apply proven countermeasure from ${item.sourceTag}. ${item.firstShotRecommendation}`),
    ...matchingStandards.flatMap((standard) =>
      standard.checklist
        .filter((item) => item.check.trim())
        .slice(0, 2)
        .map((item) => `Confirm baseline standard ${standard.sourceSheet} item ${item.no}: ${item.check}`),
    ),
  ];

  return Array.from(new Set(actions.filter((action) => compactText(action) !== compactText(recommendation)))).slice(0, 5);
}

function buildValidations(newTool: NewToolInput, evidence: ScoredCase[], matchingStandards: BaselineStandard[]): string[] {
  const validations: string[] = [
    `Confirm S/O/D ${evidence[0]?.severity ?? "-"} / ${evidence[0]?.occurrence ?? "-"} / ${
      evidence[0]?.detection ?? "-"
    } against current design risk.`,
    `Review CDI source ${newTool.cdiSource?.sheet ?? "manual input"} row ${newTool.cdiSource?.row ?? "-"} for tool no, resin, gating, cavity, cycle time, weekly capacity, part weight, and tool class.`,
  ];

  if (newTool.cycleTimeSec) {
    validations.push(`Validate cycle time target ${newTool.cycleTimeSec}s at ${newTool.cavity} cav and ${newTool.machineTon ?? "-"}T machine.`);
  }

  if (newTool.weeklyCapacityToys) {
    validations.push(`Check weekly capacity ${newTool.weeklyCapacityToys.toFixed(2)}K toys against production demand and tool efficiency.`);
  }

  if (newTool.sizeInch) {
    const { l, w, h, thk } = newTool.sizeInch;
    validations.push(
      `Confirm tool envelope L/W/H/THK ${l ?? "-"}/${w ?? "-"}/${h ?? "-"}/${thk ?? "-"} inch with slide count ${
        newTool.slideCount ?? 0
      }.`,
    );
  }

  if (matchingStandards.length) {
    validations.push(
      `Run baseline checklist from ${matchingStandards.map((standard) => standard.sourceSheet).join(", ")} before First Shot.`,
    );
  } else {
    validations.push("No matching baseline standard found; engineer should assign or create the baseline checklist.");
  }

  return validations.slice(0, 7);
}

export function scoreHistoricalCase(
  newTool: NewToolInput,
  historicalCase: HistoricalFmeaCase,
  failureCountsByFamily: Record<string, Record<string, number>>,
): ScoreResult {
  const normalizedFamily = normalizeToolDescription(newTool.toolDescription).normalizedFamily;
  const newMaterial = normalizeMaterial(newTool.material);
  const historicalMaterial = normalizeMaterial(historicalCase.material);
  const newGateType = normalizeGateType(newTool.gateType);
  const historicalGateType = normalizeGateType(historicalCase.gateType);
  const reasons: string[] = [];
  const penalties: string[] = [];
  let score = 0;

  if (normalizedFamily === historicalCase.normalizedFamily) {
    score += 45;
    reasons.push(`Similar part design: ${normalizedFamily}`);
  }

  if (newMaterial && newMaterial === historicalMaterial) {
    score += 15;
    reasons.push(`Same material: ${newMaterial}`);
  }

  if (newGateType && newGateType === historicalGateType) {
    score += 10;
    reasons.push(`Same gate type: ${newGateType}`);
  }

  if (
    normalizedFamily === historicalCase.normalizedFamily &&
    (failureCountsByFamily[historicalCase.normalizedFamily]?.[historicalCase.failure] ?? 0) > 1
  ) {
    score += 10;
    reasons.push(`Repeated issue for similar part design: ${historicalCase.failure}`);
  }

  if (historicalCase.status === "Close FS" || historicalCase.status === "Close NS") {
    score += 10;
    reasons.push(`Closed finding: ${historicalCase.status}`);
  }

  if (DIMENSION_OR_ACTION_DETAIL.test(historicalCase.recommendation)) {
    score += 5;
    reasons.push("Recommendation includes dimensional or action detail");
  }

  const combinedText = `${historicalCase.status} ${historicalCase.recommendation} ${historicalCase.notes}`;
  if (REJECTION_OR_BREAK_RISK.test(combinedText)) {
    score -= 15;
    penalties.push("Rejected or break-risk supplier comment");
  }

  return {
    score,
    reasons,
    penalties,
  };
}

function toEvidenceCase(item: ScoredCase): EvidenceCase {
  return {
    id: item.id,
    projectCode: item.projectCode,
    projectName: item.projectName,
    toolNo: item.toolNo,
    toolDescription: item.toolDescription,
    normalizedFamily: item.normalizedFamily,
    sourceTag: item.sourceTag,
    sourcePage: item.sourcePage,
    failure: item.failure,
    recommendation: item.recommendation,
    firstShotFinding: item.firstShotFinding,
    firstShotRecommendation: item.firstShotRecommendation,
    status: item.status,
    severity: item.severity,
    occurrence: item.occurrence,
    detection: item.detection,
    rpn: item.rpn,
    similarityScore: Math.max(0, item.score),
    similarityReasons: [...item.reasons, ...item.penalties],
  };
}

function chooseRecommendation(evidence: ScoredCase[], taxonomy?: FailureTaxonomyItem): string {
  const preferred = evidence.find((item) => item.status !== "Rejected") ?? evidence[0];
  return preferred?.recommendation ?? taxonomy?.typicalRecommendation ?? "";
}

function dedupeReasons(evidence: ScoredCase[]): string[] {
  const seen = new Set<string>();
  const reasons: string[] = [];

  for (const item of evidence) {
    for (const reason of [...item.reasons, ...item.penalties]) {
      if (!seen.has(reason)) {
        seen.add(reason);
        reasons.push(reason);
      }
    }
  }

  return reasons;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function groupByFailure(scoredCases: ScoredCase[]) {
  return scoredCases.reduce<Record<string, ScoredCase[]>>((acc, item) => {
    acc[item.failure] ??= [];
    acc[item.failure].push(item);
    return acc;
  }, {});
}

function getReviewStatus(confidenceScore: number, evidence: ScoredCase[]): ReviewStatus {
  const allEvidenceRejected = evidence.every((item) => item.status === "Rejected");
  const hasBreakRiskPenalty = evidence.some((item) => item.penalties.length > 0);

  if (confidenceScore < REVIEW_TRIGGER_SCORE || allEvidenceRejected || hasBreakRiskPenalty) {
    return "Needs Engineer Review";
  }

  return "Draft";
}

export function generateFmeaSuggestions(
  newTools: NewToolInput[],
  historicalCases: HistoricalFmeaCase[],
  failureTaxonomy: FailureTaxonomyItem[],
  standards: BaselineStandard[] = baselineStandards,
): AiSuggestion[] {
  const failureCountsByFamily = buildFailureCountsByFamily(historicalCases);
  const suggestions: AiSuggestion[] = [];

  for (const newTool of newTools) {
    const normalizedFamily = normalizeToolDescription(newTool.toolDescription).normalizedFamily;
    const scoredCases = historicalCases
      .map((historicalCase): ScoredCase => {
        const score = scoreHistoricalCase(newTool, historicalCase, failureCountsByFamily);
        return {
          ...historicalCase,
          ...score,
        };
      })
      .filter((item) => item.score >= 35)
      .sort((a, b) => b.score - a.score || b.rpn - a.rpn);

    const grouped = groupByFailure(scoredCases);
    const rankedGroups = Object.entries(grouped)
      .map(([failure, cases]) => {
        const sortedEvidence = cases.sort((a, b) => b.score - a.score || b.rpn - a.rpn);
        const topEvidence = sortedEvidence.slice(0, 4);
        const bestScore = topEvidence[0]?.score ?? 0;
        const evidenceDepthBonus = Math.min(8, Math.max(0, topEvidence.length - 1) * 3);
        const confidenceScore = Math.min(100, Math.max(0, Math.round(bestScore + evidenceDepthBonus)));

        return {
          failure,
          evidence: topEvidence,
          confidenceScore,
          maxRpn: Math.max(...topEvidence.map((item) => item.rpn)),
        };
      })
      .filter((group) => group.evidence.length > 0)
      .sort((a, b) => b.confidenceScore - a.confidenceScore || b.maxRpn - a.maxRpn)
      .slice(0, 2);

    for (const group of rankedGroups) {
      const taxonomy = getTaxonomyForFailure(group.failure, failureTaxonomy);
      const topEvidence = group.evidence[0];
      if (!topEvidence) continue;

      const severity = taxonomy?.severity ?? topEvidence.severity;
      const occurrence = taxonomy?.occurrence ?? topEvidence.occurrence;
      const detection = taxonomy?.detection ?? topEvidence.detection;
      const rpn = calculateRpn(severity, occurrence, detection);
      const evidenceCases = group.evidence.map(toEvidenceCase);
      const confidence = getConfidence(group.confidenceScore);
      const reason = dedupeReasons(group.evidence).slice(0, 5).join("; ");
      const matchingStandards = getMatchingBaselineStandards(newTool, standards);
      const recommendation = chooseRecommendation(group.evidence, taxonomy);

      suggestions.push({
        id: `${newTool.id}-${slugify(group.failure)}`,
        projectCode: newTool.projectCode,
        projectName: newTool.projectName,
        toolNo: newTool.toolNo,
        toolDescription: newTool.toolDescription,
        normalizedFamily,
        material: normalizeMaterial(newTool.material),
        moldMaterial: newTool.moldMaterial,
        gateType: normalizeGateType(newTool.gateType),
        cavity: Number(newTool.cavity),
        partWeightG: Number(newTool.partWeightG),
        failure: group.failure,
        stage: taxonomy?.stage ?? topEvidence.stage,
        recommendation,
        firstShot: topEvidence.firstShotFinding,
        firstShotRecommendation: topEvidence.firstShotRecommendation,
        nextShotRecommendation: taxonomy?.typicalRecommendation ?? topEvidence.firstShotRecommendation,
        severity,
        occurrence,
        detection,
        rpn,
        confidence,
        confidenceScore: group.confidenceScore,
        reason,
        recommendedActions: buildRecommendedActions(recommendation, group.evidence, matchingStandards),
        validations: buildValidations(newTool, group.evidence, matchingStandards),
        validationComment: "",
        baselineStandards: matchingStandards.map((standard) => ({
          standardId: standard.id,
          toolDescription: standard.toolDescription,
          sourceSheet: standard.sourceSheet,
          checklistCount: standard.checklist.length,
        })),
        evidence: evidenceCases,
        reviewStatus: getReviewStatus(group.confidenceScore, group.evidence),
        reviewerNotes: "",
        actionFamily: taxonomy?.actionFamily ?? topEvidence.actionFamily,
      });
    }
  }

  return suggestions;
}
