/** Project-level metadata parsed from a CDI Excel file. */
export type ProjectMetadata = {
  projectName: string;
  sourceFilename: string;
  toolMaker: string;
  vendor: string;
  quoteType: string;
  toyYear: string;
  revision: string;
  toolPlan: string;
  setCount: string;
  leadTimeDays: number | null;
};

/** A single image uploaded for a tool row. */
export type ToolImage = {
  id: string;
  file: File;
  thumbnailUrl: string;
  filename: string;
};

/** A single tooling row parsed from a CDI file or entered manually. */
export type ToolRow = {
  id: string;
  sourceSheet: string;
  sourceRowNumber: number;
  toolNo: string;
  /**
   * The description exactly as it appears in the workbook. This is what gets
   * sent to the API: `normalizeToolDescription` is not idempotent (for example
   * "FP21009-TORSO FT" normalizes to "Fp21009 Torso FT" and then to
   * "Torso FT"), and the database column was normalized once from the raw
   * value, so the server must normalize once from the raw value too.
   */
  rawToolDescription: string;
  /** Normalized form, used for display and local grouping only. */
  toolDescription: string;
  partDescription: string;
  partWeight: number | null;
  material: string;
  moldMaterial: string;
  gateType: string;
  cavity: number | null;
  cycleTimeSec: number | null;
  weeklyCapacity: number | null;
  toolAid: string;
  toolBuild: string;
  length: number | null;
  width: number | null;
  height: number | null;
  thickness: number | null;
  slides: number | null;
  color: string;
  machineTonnage: number | null;
  className: string;
  refPartNumber: string;
  decoration: string;
  assembly: string;
  rawRowData: Record<string, unknown>;
  images: ToolImage[];
  /**
   * "no-evidence" means the row was processed but no historical failure mode
   * matched it, which is materially different from a draft having been
   * generated for it.
   */
  draftStatus: "pending" | "generating" | "generated" | "no-evidence" | "error";
  selected: boolean;
};

/** Result of parsing a CDI file. */
export type CdiParseResult = {
  metadata: ProjectMetadata;
  toolRows: ToolRow[];
  warnings: string[];
};

/** The overall application workflow state. */
export type WorkflowStage =
  | "upload"
  | "review-tools"
  | "generating"
  | "review-fmea"
  | "export";

/** Draft scope options for FMEA generation. */
export type DraftScope =
  | "all"
  | "selected"
  | "with-images"
  | "without-draft";
