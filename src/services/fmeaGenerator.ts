import type { ToolRow, ProjectMetadata } from "../types/project";
import type { FmeaDraftRow } from "../types/fmea";
import type { NewToolInput } from "../data/fmeaMockData";
import { historicalFmeaCases, failureTaxonomy } from "../data/fmeaMockData";
import { generateFmeaSuggestions, consolidateToolRows } from "../lib/fmeaEngine";

/**
 * Convert a ToolRow to the legacy NewToolInput format for the existing engine.
 */
function toNewToolInput(row: ToolRow, metadata: ProjectMetadata): NewToolInput {
  return {
    id: row.id,
    projectCode: metadata.projectName || "UPLOADED",
    projectName: metadata.projectName || "Uploaded Project",
    toolNo: row.toolNo,
    toolDescription: row.toolDescription,
    material: row.material,
    moldMaterial: row.moldMaterial,
    gateType: row.gateType,
    cavity: row.cavity ?? 1,
    partWeightG: row.partWeight ?? 0,
    toolAid: row.toolAid,
    toolBuild: row.toolBuild,
    sizeInch: {
      l: row.length ?? undefined,
      w: row.width ?? undefined,
      h: row.height ?? undefined,
      thk: row.thickness ?? undefined,
    },
    slideCount: row.slides ?? undefined,
    color: row.color,
    machineTon: row.machineTonnage ?? undefined,
    toolClass: row.className || undefined,
    refPartNumber: row.refPartNumber,
    decoration: row.decoration,
    assembly: row.assembly,
    cycleTimeSec: row.cycleTimeSec ?? undefined,
    weeklyCapacityToys: row.weeklyCapacity ?? undefined,
    cdiSource: {
      workbook: metadata.sourceFilename,
      sheet: row.sourceSheet,
      row: row.sourceRowNumber,
    },
  };
}

/**
 * Generate FMEA draft rows using the local deterministic engine.
 * Falls back to this when no AI API key is configured.
 */
export function generateLocalFmea(
  toolRows: ToolRow[],
  metadata: ProjectMetadata,
): FmeaDraftRow[] {
  const legacyInputs = toolRows.map((row) => toNewToolInput(row, metadata));
  const consolidated = consolidateToolRows(legacyInputs);
  const suggestions = generateFmeaSuggestions(consolidated, historicalFmeaCases, failureTaxonomy);

  return suggestions.map((s) => ({
    id: s.id,
    toolRowId: s.id.split("-").slice(0, -1).join("-") || s.id,
    toolNo: s.toolNo,
    partDescription: s.toolDescription,
    processStep: s.stage,
    potentialFailureMode: s.failure,
    potentialEffect: s.firstShot || `Potential ${s.failure.toLowerCase()} on ${s.toolDescription}`,
    severity: s.severity,
    potentialCause: s.reason,
    occurrence: s.occurrence,
    currentPreventionControl: s.recommendedActions[0] || "Review tooling design",
    currentDetectionControl: s.validations[0] || "First shot inspection",
    detection: s.detection,
    rpn: s.rpn,
    recommendedAction: s.recommendation,
    responsibleFunction: "Tooling Engineer",
    targetDate: "",
    evidenceUsed: s.evidence.map((e) => `${e.sourceTag} p${e.sourcePage}: ${e.failure}`),
    confidence: s.confidence,
    confidenceScore: s.confidenceScore,
    aiRationale: s.reason,
    status: s.reviewStatus === "Needs Engineer Review" ? "draft" : "draft",
    reviewerNotes: "",
    baselineStandards: s.baselineStandards,
  }));
}

export type GenerateFmeaResult = {
  drafts: FmeaDraftRow[];
  metadata?: ProjectMetadata;
};

export async function generateFmea(
  toolRows: ToolRow[],
  metadata: ProjectMetadata,
): Promise<GenerateFmeaResult> {
  try {
    console.info(`[FMEA Generator] Sending ${toolRows.length} tools to backend API...`);
    
    const response = await fetch('/api/fmea/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tools: toolRows, metadata })
    });
    
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server responded with ${response.status}`);
    }
    
    const data = await response.json();
    console.info(`[FMEA Generator] Received ${data.drafts?.length || 0} drafts from server`);
    
    // Log metadata status for debugging
    if (data.metadata) {
      console.info('[FMEA Generator] Server returned metadata:', data.metadata);
    } else {
      console.warn('[FMEA Generator] Server did not return metadata');
    }
    
    return {
      drafts: data.drafts as FmeaDraftRow[],
      metadata: data.metadata
    };
    
  } catch (error) {
    console.error('[FMEA Generator] Error calling backend API:', error);
    // Fallback to local engine if server is unreachable
    console.warn('[FMEA Generator] Falling back to local deterministic engine.');
    return {
      drafts: generateLocalFmea(toolRows, metadata),
      metadata: undefined
    };
  }
}
