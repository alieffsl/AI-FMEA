import type { ToolRow, ProjectMetadata } from "../types/project";
import type { RagEvidence } from "../types/rag";

/**
 * Build a structured prompt for AI FMEA draft generation.
 * This prompt instructs the model to act as an experienced tooling FMEA engineer.
 */
export function buildFmeaPrompt(
  metadata: ProjectMetadata,
  toolRows: ToolRow[],
  evidenceByTool: Map<string, RagEvidence[]>,
): string {
  const toolSections = toolRows.map((row) => {
    const evidence = evidenceByTool.get(row.id) ?? [];
    const evidenceText = evidence
      .slice(0, 8)
      .map((e, i) => `  ${i + 1}. [${e.sourceType}] ${e.title} (score: ${e.relevanceScore}) — ${e.text}`)
      .join("\n");

    return `
### Tool Row: ${row.toolNo} — ${row.toolDescription}
- Material: ${row.material || "Not specified"}
- Mold Material: ${row.moldMaterial || "Not specified"}
- Gate Type: ${row.gateType || "Not specified"}
- Cavity: ${row.cavity ?? "N/A"}
- Part Weight: ${row.partWeight ?? "N/A"} g
- Dimensions (L×W×H×THK): ${row.length ?? "-"} × ${row.width ?? "-"} × ${row.height ?? "-"} × ${row.thickness ?? "-"}
- Slides: ${row.slides ?? 0}
- Machine Tonnage: ${row.machineTonnage ?? "N/A"}
- Class: ${row.className || "N/A"}
- Color: ${row.color || "N/A"}
- Images: ${row.images.length > 0 ? `${row.images.length} reference image(s) uploaded` : "No images"}

#### Retrieved Evidence (${evidence.length} items):
${evidenceText || "  No matching evidence found."}
`;
  });

  return `You are an experienced tooling FMEA engineer specializing in injection-molded toy and consumer product parts.

## Task
Generate practical, evidence-based FMEA draft suggestions for the following tooling rows. For each tool row, generate 2–5 failure mode rows when sufficient evidence exists.

## Project Context
- Project: ${metadata.projectName}
- Source CDI: ${metadata.sourceFilename}
- Tool Maker: ${metadata.toolMaker || "Not specified"}
- Vendor: ${metadata.vendor || "Not specified"}
- Quote Type: ${metadata.quoteType || "Not specified"}
- Toy Year: ${metadata.toyYear || "Not specified"}

## Tool Rows
${toolSections.join("\n")}

## Rules
1. Generate ONLY evidence-based suggestions. Cite the evidence used.
2. Avoid vague, generic failures. Be specific to the tool geometry, material, gating, and process.
3. Severity, Occurrence, Detection must be numeric (1–10 scale). RPN = S × O × D.
4. Include confidence level (High/Medium/Low) and explain reasoning.
5. When evidence is insufficient, set confidence to "Low" and explain why.
6. Do NOT hallucinate. If you lack information, say so.
7. Use tooling-specific risk language (flash, burr, sink, short shot, weld line, warpage, ejection marks, etc.)

## Output Format
Return a JSON array of objects with this exact schema:
\`\`\`json
[{
  "toolNo": "string",
  "partDescription": "string",
  "processStep": "string",
  "potentialFailureMode": "string",
  "potentialEffect": "string",
  "severity": number,
  "potentialCause": "string",
  "occurrence": number,
  "currentPreventionControl": "string",
  "currentDetectionControl": "string",
  "detection": number,
  "rpn": number,
  "recommendedAction": "string",
  "evidenceUsed": ["string"],
  "confidence": "High" | "Medium" | "Low",
  "confidenceScore": number,
  "aiRationale": "string"
}]
\`\`\`

Return ONLY the JSON array. No markdown fences, no explanation text.`;
}
