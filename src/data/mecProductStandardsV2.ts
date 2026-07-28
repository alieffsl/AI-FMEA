import mecRawDb from "./mec_product_standard_v2.json";

export interface MecV2Section {
  title: string;
  content: string;
  image_references: string[];
  image_original_references?: string[];
  image_captions?: string[];
  type: "guideline" | "design_rule" | "goal" | "reference";
  table?: {
    columns: string[];
    rows: string[][];
  };
}

export interface MecV2Page {
  slug: string;
  title: string;
  page_type: string;
  sections: MecV2Section[];
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function informationScore(page: MecV2Page): number {
  return page.sections.reduce(
    (total, section) => total + section.title.length + section.content.length + section.image_references.length * 100,
    0,
  );
}

/**
 * The extracted database can contain the same source article more than once
 * (usually with a generated `-1` slug). Keep the most complete extraction and
 * retain the first article's stable slug so bookmarks do not change.
 */
function deduplicatePages(pages: MecV2Page[]): MecV2Page[] {
  const groups = new Map<string, MecV2Page[]>();

  pages.forEach((page) => {
    const key = normalizeTitle(page.title);
    groups.set(key, [...(groups.get(key) ?? []), page]);
  });

  return Array.from(groups.values()).map((group) => {
    const canonicalSlug = group[0].slug.replace(/-\d+$/, "");
    const mostComplete = group.reduce((best, page) =>
      informationScore(page) > informationScore(best) ? page : best,
    );

    return { ...mostComplete, slug: canonicalSlug };
  });
}

export const mecV2Db = deduplicatePages(mecRawDb as MecV2Page[]);

export function getV2Page(slug: string): MecV2Page | undefined {
  return mecV2Db.find(p => p.slug === slug);
}

export function searchV2Pages(query: string): MecV2Page[] {
  if (!query.trim()) return mecV2Db;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return mecV2Db.filter(page => {
    const text = [page.title, ...page.sections.map(s => s.title + " " + s.content)].join(" ").toLowerCase();
    return terms.every(term => text.includes(term));
  });
}
