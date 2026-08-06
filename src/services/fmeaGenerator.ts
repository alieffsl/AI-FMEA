import type { ToolRow, ProjectMetadata } from "../types/project";
import type { FmeaDraftRow } from "../types/fmea";

/**
 * What the API actually needs for a tool row.
 *
 * Deliberately lean: the full `ToolRow` carries `rawRowData` (every parsed cell)
 * and `images` (File objects that serialise to `{}`), neither of which the
 * server reads. Sending them inflated every request against a 10 MB body limit.
 */
type GenerateToolPayload = {
  id: string;
  toolNo: string;
  toolDescription: string;
  material: string;
  gateType: string;
  cavity: number | null;
};

function toPayload(row: ToolRow): GenerateToolPayload {
  return {
    id: row.id,
    toolNo: row.toolNo,
    // Raw, not normalized: the server normalizes exactly once, the same way the
    // `tool_description_normalized` column was built. Normalizing here as well
    // would double-apply the prefix rules and stop matching.
    toolDescription: row.rawToolDescription || row.toolDescription,
    material: row.material,
    gateType: row.gateType,
    cavity: row.cavity,
  };
}

export type GenerateFmeaResult = {
  drafts: FmeaDraftRow[];
  metadata?: ProjectMetadata;
};

export async function generateFmea(
  toolRows: ToolRow[],
  metadata: ProjectMetadata,
): Promise<GenerateFmeaResult> {
  let response: Response;

  try {
    response = await fetch("/api/fmea/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tools: toolRows.map(toPayload), metadata }),
    });
  } catch (cause) {
    // Previously this fell through to a local engine backed by demo data, which
    // meant a server outage produced a plausible but entirely fictional FMEA.
    // Failing loudly is the only safe behaviour for a document used to make
    // tooling decisions.
    throw new Error(
      "Could not reach the FMEA server. Check that the API is running, then try again.",
      { cause },
    );
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}) as { error?: string });
    throw new Error(errData.error || `The FMEA server responded with ${response.status}.`);
  }

  const data = await response.json();

  if (!Array.isArray(data?.drafts)) {
    throw new Error("The FMEA server returned an unexpected response.");
  }

  return {
    drafts: data.drafts as FmeaDraftRow[],
    metadata: data.metadata,
  };
}
