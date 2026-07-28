/** Evidence retrieved from RAG for a specific tool row. */
export type RagEvidence = {
  evidenceId: string;
  sourceType: "historical_fmea" | "baseline_standard" | "image_reference";
  sourceName: string;
  sourceSheet: string;
  sourceRow: number | null;
  title: string;
  text: string;
  imagePaths: string[];
  relevanceScore: number;
  reasons: string[];
};
