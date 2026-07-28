/**
 * MEC Product Standard Database — Data Layer
 *
 * Typed access to the single-file English database generated from the
 * MEC Product Standard Excel workbook. Contains 18 pages, 38 guideline
 * sections, 35 product cards, 86 image assets, and 102 navigation items.
 */

import mecRawDb from "../../mec_product_standard_single_english_database.json";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type MecPageType =
  | "revision_history"
  | "home_tree"
  | "product_gallery"
  | "navigation_hub"
  | "guideline_article"
  | "technical_reference";

export interface MecPage {
  id: string;
  slug: string;
  title: string;
  page_type: MecPageType;
  summary: string;
  breadcrumb: string[];
  section_ids: string[];
  product_card_ids: string[];
  navigation_card_ids: string[];
  navigation_item_ids: string[];
  image_ids: string[];
  link_ids: string[];
  revision_history: MecRevisionHistory | null;
  source: {
    workbook: string;
    sheet_name_original: string;
    used_range: string;
  };
  content_counts: {
    sections: number;
    product_cards: number;
    navigation_cards: number;
    navigation_items: number;
    images: number;
    links: number;
  };
}

export interface MecRevisionHistory {
  initial_release?: {
    revision: string;
    description: string;
    source_cells: string[];
  };
  contacts: Array<{
    department: string;
    contact: string;
    source_cell: string;
  }>;
  updates: Array<{
    date: string;
    sequence: number;
    description: string;
    source_cells: string[];
  }>;
}

export interface MecGuidelineSection {
  id: string;
  page_slug: string;
  number: string;
  title: string;
  body: string;
  type: "guideline" | "design_rule" | "goal" | "reference";
  image_ids: string[];
  link_ids: string[];
  review_notes: string[];
  source: {
    sheet_name_original: string;
    cells: string[];
    rows?: number[];
  };
}

export interface MecProductCardLink {
  label: string;
  link_id: string;
  target_display_english: string;
  target_preserved: string;
  type: string;
  status: string;
  source_cell: string;
}

export interface MecProductCard {
  id: string;
  page_slug: string;
  type: string;
  model_code: string;
  title: string;
  source_factory: string;
  details: string[];
  image_ids: string[];
  links: MecProductCardLink[];
  source: {
    sheet_name_original: string;
    cells: string[];
    anchor_region?: {
      start_row: number;
      end_row: number;
      start_col: number;
      end_col: number;
    };
  };
  needs_human_review: boolean;
}

export interface MecNavigationCard {
  id: string;
  page_slug: string;
  title: string;
  subtitle: string | null;
  image_ids: string[];
  link_ids: string[];
  target_page_slug: string | null;
  target_status: string;
  source: {
    sheet_name_original: string;
    cells: string[];
  };
}

export interface MecNavigationItem {
  id: string;
  title: string;
  category: string;
  brand_or_product_group: string;
  subcategory: string;
  owner: string | null;
  status: string | null;
  update_note: string | null;
  target_page_slug: string | null;
  link_ids: string[];
  source: {
    sheet_name_original: string;
    row: number;
    cells: string[];
  };
}

export interface MecAsset {
  id: string;
  source_sheet_name_original: string;
  source_sheet_slug: string;
  original_media_path: string;
  file_type: string;
  width_px: number | null;
  height_px: number | null;
  display_size: {
    cx_emu: number;
    cy_emu: number;
    width_in: number;
    height_in: number;
  };
  anchor: {
    from_row: number;
    from_col: number;
    to_row: number;
    to_col: number;
  };
  nearest_text_english: string;
  original_media_id: string;
  web_media_id: string;
  browser_display_ready: boolean;
  conversion_status: string;
  source: {
    drawing_path: string;
    drawing_anchor_type: string;
    drawing_anchor_index: number;
    drawing_name: string;
    relationship_id: string;
    nearest_text_cell: string;
  };
}

export interface MecMedia {
  id: string;
  file_name: string;
  file_type: string;
  mime_type: string;
  sha256: string;
  size_bytes: number;
  width_px: number | null;
  height_px: number | null;
  browser_supported: boolean;
  conversion_note: string | null;
  data_uri: string;
}

export interface MecLink {
  id: string;
  label: string;
  type: string;
  status: string;
  target_page_slug: string | null;
  target_display_english: string;
  target_original_preserved: string;
  target_normalized_preserved: string;
  source: {
    source_type: string;
    sheet_name_original: string;
    cell_or_object_ref: string;
    merged_range?: string;
  };
}

export interface MecSearchDocument {
  page_slug: string;
  title: string;
  page_type: string;
  searchable_text: string;
}

export type MecNavigationTree = Record<
  string,
  Record<string, Record<string, string[]> | string[]>
>;

export interface MecDatabase {
  schema_version: string;
  database_name: string;
  generated_at_utc: string;
  language: string;
  purpose: string;
  source_workbook: {
    file_name: string;
    sheet_count: number;
    note: string;
  };
  statistics: {
    pages: number;
    navigation_items: number;
    navigation_cards: number;
    product_cards: number;
    guideline_sections: number;
    image_assets: number;
    unique_media_blobs: number;
    links: number;
    search_documents: number;
  };
  records: {
    pages: Record<string, MecPage>;
    guideline_sections: Record<string, MecGuidelineSection>;
    product_cards: Record<string, MecProductCard>;
    navigation_cards: Record<string, MecNavigationCard>;
    navigation_items: Record<string, MecNavigationItem>;
    links: Record<string, MecLink>;
    assets: Record<string, MecAsset>;
    media: Record<string, MecMedia>;
  };
  indexes: {
    page_order: string[];
    navigation_tree: MecNavigationTree;
    search_documents: MecSearchDocument[];
    assets_by_sheet_slug: Record<string, string[]>;
    links_by_status: Record<string, string[]>;
    links_by_type: Record<string, string[]>;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Database singleton
// ═══════════════════════════════════════════════════════════════════════════

export const mecDb = mecRawDb as unknown as MecDatabase;

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/** Look up a page by slug. Returns undefined if not found. */
export function getPage(slug: string): MecPage | undefined {
  return mecDb.records.pages[slug];
}

/** Look up a guideline section by ID. */
export function getSection(id: string): MecGuidelineSection | undefined {
  return mecDb.records.guideline_sections[id];
}

/** Look up a product card by ID. */
export function getProductCard(id: string): MecProductCard | undefined {
  return mecDb.records.product_cards[id];
}

/** Look up a navigation card by ID. */
export function getNavigationCard(id: string): MecNavigationCard | undefined {
  return mecDb.records.navigation_cards[id];
}

/** Look up a navigation item by ID. */
export function getNavigationItem(id: string): MecNavigationItem | undefined {
  return mecDb.records.navigation_items[id];
}

/** Look up a link by ID. */
export function getLink(id: string): MecLink | undefined {
  return mecDb.records.links[id];
}

/**
 * Resolve an asset ID to its browser-displayable data URI.
 * Falls back to the web_media_id (converted PNG) first, then original.
 */
export function getAssetDataUri(assetId: string): string | null {
  const asset = mecDb.records.assets[assetId];
  if (!asset) return null;

  // Try the web (converted) media first
  const webMedia = mecDb.records.media[asset.web_media_id];
  if (webMedia?.data_uri) return webMedia.data_uri;

  // Fall back to original media
  const origMedia = mecDb.records.media[asset.original_media_id];
  if (origMedia?.data_uri) return origMedia.data_uri;

  return null;
}

/** Get asset metadata. */
export function getAsset(assetId: string): MecAsset | undefined {
  return mecDb.records.assets[assetId];
}

/** Get the navigation tree (By Product / Common Design / Feature Toy). */
export function getNavigationTree(): MecNavigationTree {
  return mecDb.indexes.navigation_tree;
}

/** Get ordered page slugs. */
export function getPageOrder(): string[] {
  return mecDb.indexes.page_order;
}

/** Get all pages as an array, in order. */
export function getAllPages(): MecPage[] {
  return mecDb.indexes.page_order
    .map((slug) => mecDb.records.pages[slug])
    .filter(Boolean);
}

/**
 * Search pages by query string. Returns matching search documents.
 * Case-insensitive, matches all space-separated terms.
 */
export function searchPages(query: string): MecSearchDocument[] {
  if (!query.trim()) return mecDb.indexes.search_documents;

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  return mecDb.indexes.search_documents.filter((doc) => {
    const text = doc.searchable_text.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

/** Get statistics summary. */
export function getStats() {
  return mecDb.statistics;
}
