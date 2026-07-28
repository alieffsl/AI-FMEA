import {
  ragAccessories,
  ragBaselineChecks,
  ragImagesById,
  ragReferenceHandring,
  ragSourceWorkbook,
} from "./accessoriesRagData";
import type { MecV2Page, MecV2Section } from "./mecProductStandardsV2";
import accessoryToolingAiRaw from "./accessory_tooling_ai_database.json";

export type BaselineChecklistItem = {
  id: string;
  no: string;
  check: string;
  remark: string;
  sourceRow: number;
  requirementType?: string;
  sourceCell?: string;
  evidenceImageIds?: string[];
  reviewFlag?: string;
};

export type BaselineReferenceRow = {
  id: string;
  toyNo: string;
  tool: string;
  buildYear: string;
  builtBy: string;
  modelDimension: string;
  actualDimension: string;
  vum: string;
  drill: string;
  remark: string;
  production: string;
  evidenceImageIds?: string[];
};

export type BaselineStandard = {
  id: string;
  toolDescription: string;
  sourceSheet: string;
  category: "Accessory" | "Decoration" | "Assembly" | "Mold Design" | "Reference";
  aliases: string[];
  sourceWorkbook: string;
  notes: string;
  checklist: BaselineChecklistItem[];
  references?: BaselineReferenceRow[];
  contentType?: string;
  rowsWithText?: number;
  rowsMissingText?: number;
  imageIds?: string[];
  imageOccurrences?: number;
  drawingTextLabels?: number;
};

export const baselineSourceWorkbook = ragSourceWorkbook;

const aliasMap: Record<string, string[]> = {
  EARRING: ["earring", "ear ring", "post accessory"],
  HANDRING: ["handring", "hand ring", "ring"],
  HEADBAND: ["headband", "head band", "hair band"],
  BELT: ["belt", "waist belt", "breakaway belt"],
  BRACELET: ["bracelet", "bangle"],
  NECKLACE: ["necklace", "chain", "loop necklace"],
  "BACKPACK ASSY": ["backpack", "backpack assy", "bag", "bag cover", "bag-cover", "dog bag", "strap", "handle"],
  "STD ELECTRODE PTMI": ["electrode", "ptmi electrode", "std electrode"],
  GLASSES: ["glasses", "sunglass", "sun glass", "eyewear", "thin frame"],
  "HAIR CLIP": ["hair clip", "hair-clip", "clip", "hinge clip"],
  SHOES: ["shoes", "shoe", "footwear", "sole"],
  "PET(SEPARATE HEAD)": ["pet", "dog body", "dog head", "dog tail", "tail body", "separate head", "neck", "body shell", "torso"],
  "SHOULDER CONNECTOR": ["shoulder connector", "connector", "shoulder", "socket connector"],
  ARM: ["arm", "straight arm", "bent arm", "pocket connector"],
  "VUM HOLDER": ["vum holder", "holder", "vum", "clip holder"],
  ROTOHEAD: ["rotohead", "roto head"],
  "MARKING & GENUINE": ["marking", "genuine mark", "logo mark"],
  "C CLIP BOTTLE": ["c clip", "c-clip", "bottle clip", "clip bottle"],
};

const displayNameMap: Record<string, string> = {
  EARRING: "Earring",
  HANDRING: "Handring",
  HEADBAND: "Headband",
  BELT: "Belt",
  BRACELET: "Bracelet",
  NECKLACE: "Necklace",
  "BACKPACK ASSY": "Backpack Assembly",
  "STD ELECTRODE PTMI": "STD Electrode PTMI",
  GLASSES: "Glasses",
  "HAIR CLIP": "Hair Clip",
  SHOES: "Shoes",
  "PET(SEPARATE HEAD)": "Pet Separate Head",
  "SHOULDER CONNECTOR": "Shoulder Connector",
  ARM: "Arm",
  "VUM HOLDER": "VUM Holder",
  ROTOHEAD: "Rotohead",
  "MARKING & GENUINE": "Marking & Genuine",
  "C CLIP BOTTLE": "C Clip Bottle",
};

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getCategory(accessory: string, contentType: string): BaselineStandard["category"] {
  if (contentType === "Reference table") return "Reference";
  if (accessory === "MARKING & GENUINE") return "Decoration";
  if (["BACKPACK ASSY", "BELT", "PET(SEPARATE HEAD)", "SHOULDER CONNECTOR", "ARM"].includes(accessory)) {
    return "Assembly";
  }
  if (["GLASSES", "STD ELECTRODE PTMI", "VUM HOLDER", "ROTOHEAD", "C CLIP BOTTLE"].includes(accessory)) {
    return "Mold Design";
  }
  return "Accessory";
}

function getReferences(accessory: string): BaselineReferenceRow[] | undefined {
  if (accessory !== "HANDRING") return undefined;

  return ragReferenceHandring.map((item) => ({
    id: item.referenceId,
    toyNo: item.toyNo,
    tool: item.tool,
    buildYear: item.buildYear,
    builtBy: item.builtBy,
    modelDimension: item.modelDimension,
    actualDimension: item.actualDimension,
    vum: item.vum,
    drill: item.drill,
    remark: item.remark,
    production: item.production,
    evidenceImageIds: item.evidenceImageIds,
  }));
}

export const baselineStandards: BaselineStandard[] = ragAccessories.map((accessory) => {
  const checks = ragBaselineChecks
    .filter((item) => item.accessory === accessory.accessory)
    .map((item) => ({
      id: item.standardId,
      no: item.seq,
      check: item.standardText,
      remark: item.applicabilityRemark,
      sourceRow: item.sourceRow,
      requirementType: item.requirementType,
      sourceCell: item.sourceCell,
      evidenceImageIds: item.evidenceImageIds,
      reviewFlag: item.reviewFlag,
    }));

  const imageNotes = accessory.imageIds
    .map((imageId) => ragImagesById[imageId]?.suggestedAltText)
    .filter(Boolean);

  return {
    id: `std-${slugify(accessory.accessory)}`,
    toolDescription: displayNameMap[accessory.accessory] ?? accessory.accessory,
    sourceSheet: accessory.sourceSheet,
    category: getCategory(accessory.accessory, accessory.contentType),
    aliases: aliasMap[accessory.accessory] ?? [accessory.accessory.toLowerCase()],
    sourceWorkbook: baselineSourceWorkbook,
    notes:
      accessory.notes ||
      imageNotes[0] ||
      `${accessory.contentType} extracted from ${accessory.sourceSheet}.`,
    checklist: checks,
    references: getReferences(accessory.accessory),
    contentType: accessory.contentType,
    rowsWithText: accessory.rowsWithText,
    rowsMissingText: accessory.rowsMissingText,
    imageIds: accessory.imageIds,
    imageOccurrences: accessory.imageOccurrences,
    drawingTextLabels: accessory.drawingTextLabels,
  };
});

export const baselineEmptyOrImageOnlySheets = ragAccessories
  .filter((accessory) => accessory.rowsWithText === 0 && accessory.referenceRows === 0)
  .map((accessory) => accessory.sourceSheet);

type AiEvidence = {
  source_type: "cell" | "image" | "drawing_text";
  reference: string;
  observation: string;
};

type AiCheckpoint = {
  id: string;
  title: string;
  requirement: string;
  category: string;
  verification_method: string;
  acceptance_criteria: string;
  applicability: string;
  evidence: AiEvidence[];
  confidence: "high" | "medium" | "low";
  review_required: boolean;
};

type AiImage = {
  image_id: string;
  asset_url: string;
  original_asset_url: string;
  anchor: string;
  caption: string;
  observed_text: string[];
  uncertainties: string[];
};

type AiToolingStandard = {
  id: string;
  slug: string;
  title: string;
  source_sheet: string;
  source_workbook: string;
  summary: string;
  checkpoints: AiCheckpoint[];
  reference_notes: string[];
  quality_notes: string[];
  reference_tables?: Array<{
    title: string;
    columns: string[];
    rows: string[][];
  }>;
  images: AiImage[];
  evidence_counts: {
    populated_cells: number;
    drawing_text_items: number;
    image_occurrences: number;
    checkpoints: number;
    checkpoints_requiring_review: number;
  };
};

type AiToolingDatabase = {
  schema_version: string;
  generated_at: string;
  source_workbook: string;
  model: string;
  sheet_count: number;
  image_occurrence_count: number;
  standards: AiToolingStandard[];
};

export const accessoryToolingAiDatabase = accessoryToolingAiRaw as AiToolingDatabase;

function conciseTitle(standard: AiToolingStandard): string {
  return standard.source_sheet
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/Assy\b/, "Assembly")
    .replace(/Ptmi\b/, "PTMI")
    .replace(/Vum\b/, "VUM");
}

function conciseRequirement(value: string): string {
  const concise = value
    .trim()
    .replace(/^ensure (?:that )?/i, "")
    .replace(/^please /i, "")
    .replace(/^the /i, "")
    .replace(/^all (.+?) should have (.+)$/i, "$1: $2")
    .replace(/^no (.+?) is present on (.+)$/i, "No $1 on $2")
    .replace(/^(.+?) (?:must|should) have (.+)$/i, "$1: $2")
    .replace(/^(.+?) (?:must|should) be (.+)$/i, "$1: $2")
    .replace(/^(.+?) must adhere to specified values:\s*/i, "$1: ")
    .replace(/^there must be /i, "")
    .replace(/ depend on /i, " per ")
    .replace(/\s+as (?:indicated in the image analysis|per design specifications|specified in the design)\.?$/i, "")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "");
  return concise.charAt(0).toUpperCase() + concise.slice(1);
}

function conciseCheckpoint(checkpoint: AiCheckpoint): string {
  const requirement = conciseRequirement(checkpoint.requirement);
  const criteria = checkpoint.acceptance_criteria.trim().replace(/\.$/, "");
  if (!criteria || requirement.toLowerCase().includes(criteria.toLowerCase())) return requirement;
  return `${requirement} — ${criteria}`;
}

function toToolingSections(standard: AiToolingStandard): MecV2Section[] {
  const sections: MecV2Section[] = (standard.reference_tables ?? []).map((table) => ({
    title: table.title,
    content: "",
    image_references: [],
    type: "reference",
    table: { columns: table.columns, rows: table.rows },
  }));

  if (standard.checkpoints.length > 0) {
    sections.push({
      title: "Checklist",
      content: "",
      image_references: [],
      type: "guideline",
      table: {
        columns: ["", "Checklist"],
        rows: standard.checkpoints.map((checkpoint) => ["☐", conciseCheckpoint(checkpoint)]),
      },
    });
  }

  const imageReferences = [...new Set(standard.images.map((image) => image.asset_url))];
  if (imageReferences.length > 0) {
    const originalByPreview = new Map(
      standard.images.map((image) => [image.asset_url, image.original_asset_url]),
    );
    const captionByPreview = new Map(
      standard.images.map((image) => [image.asset_url, image.caption]),
    );
    sections.push({
      title: "Visual References",
      content: "",
      image_references: imageReferences,
      image_original_references: imageReferences.map((preview) => originalByPreview.get(preview) ?? preview),
      image_captions: imageReferences.map((preview) => captionByPreview.get(preview) ?? ""),
      type: "reference",
    });
  }

  return sections;
}

/** AI-generated workbook standards adapted to the shared Product Standards article format. */
export const baselineToolingPages: MecV2Page[] = accessoryToolingAiDatabase.standards.map((standard) => ({
  slug: standard.slug,
  title: conciseTitle(standard),
  page_type: "tooling_baseline",
  sections: toToolingSections(standard),
}));

export function getBaselineToolingPage(slug: string): MecV2Page | undefined {
  return baselineToolingPages.find((page) => page.slug === slug);
}

export function searchBaselineToolingPages(query: string): MecV2Page[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return baselineToolingPages;

  return baselineToolingPages.filter((page) => {
    const text = [
      page.title,
      ...page.sections.map((section) => [
        section.title,
        section.content,
        ...(section.table?.columns ?? []),
        ...(section.table?.rows.flat() ?? []),
      ].join(" ")),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
