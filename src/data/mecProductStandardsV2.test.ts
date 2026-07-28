import { describe, expect, it } from "vitest";
import { getV2Page, mecV2Db, searchV2Pages } from "./mecProductStandardsV2";
import sourceMapping from "./sourceMapping.json";
import {
  accessoryToolingAiDatabase,
  baselineStandards,
  baselineToolingPages,
  searchBaselineToolingPages,
} from "./baselineStandards";

describe("MEC product standards database", () => {
  it("exposes only one article for each normalized title", () => {
    const titles = mecV2Db.map((page) =>
      page.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    );

    expect(new Set(titles).size).toBe(titles.length);
    expect(mecV2Db).toHaveLength(74);
  });

  it("keeps canonical slugs and the most complete duplicate extraction", () => {
    expect(getV2Page("belt-design-guidelines")?.sections[0].content).toContain("1.6mm minimum depth");
    expect(getV2Page("belt-design-guidelines-1")).toBeUndefined();
    expect(searchV2Pages("Doll Stand Design").filter((page) => page.title === "Doll Stand Design"))
      .toHaveLength(1);
  });

  it("keeps Product Standards English-only with unique, valid image references", () => {
    const chinese = /[\u3400-\u9fff\uf900-\ufaff]/;
    for (const page of mecV2Db) {
      const images = page.sections.flatMap((section) => section.image_references);
      expect(new Set(images.map((image) => image.toLowerCase())).size).toBe(images.length);
      expect(chinese.test(JSON.stringify(page))).toBe(false);
    }

    const gear = getV2Page("gear-clearance-guidelines");
    expect(gear?.sections.flatMap((section) => section.image_references)).toEqual([
      "Gear.xlsm_image2.png",
    ]);
    expect(gear?.sections.find((section) => section.table)?.table?.rows).toHaveLength(6);
    expect((sourceMapping as Record<string, string>)["gear-clearance-guidelines"]).toBe("Gear.xlsm");
  });

  it("keeps the HD source when workbooks contain preview-sized duplicates", () => {
    const imagesFor = (slug: string) =>
      getV2Page(slug)?.sections.flatMap((section) => section.image_references) ?? [];

    expect(imagesFor("headband-design-guidelines")).not.toEqual(
      expect.arrayContaining(["Headband.xlsm_image1.jpeg", "Headband.xlsm_image2.jpeg"]),
    );
    expect(imagesFor("headband-design-guidelines")).toEqual(
      expect.arrayContaining(["Headband.xlsm_image4.jpg", "Headband.xlsm_image5.jpg"]),
    );
    expect(imagesFor("crown-tiara-design-guidelines")).not.toContain("Crown-Tiara.xlsm_image1.jpeg");
    expect(imagesFor("crown-tiara-design-guidelines")).toContain("Crown-Tiara.xlsm_image3.JPG");
    expect(imagesFor("belt-design-guidelines")).not.toEqual(
      expect.arrayContaining([
        "Belt.xlsm_image1.jpeg",
        "Belt.xlsm_image2.jpeg",
        "Belt.xlsm_image3.jpeg",
      ]),
    );
    expect(imagesFor("belt-design-guidelines")).toEqual(
      expect.arrayContaining(["Belt.xlsm_image6.png", "Belt.xlsm_image4.JPG", "Belt.xlsm_image8.jpg"]),
    );

    const retainedHdImages: Array<[string, string, string[]]> = [
      ["sunglass-design-guidelines", "Sunglasses.xlsm_image4.png", ["Sunglasses.xlsm_image3.png"]],
      ["doll-stand-design", "Doll Stand.xlsm_image5.jpg", ["Doll Stand.xlsm_image2.jpeg"]],
      [
        "lap-joint-design-standard",
        "Lap-joint.xlsm_image4.jpeg",
        ["Lap-joint.xlsm_image2.jpeg", "Lap-joint.xlsm_image1.jpeg"],
      ],
      ["spring-design-guidelines", "Spring.xlsm_image2.png", ["Spring.xlsm_image1.png"]],
      ["heat-stake-design", "heat-stake.xlsm_image3.jpeg", ["heat-stake.xlsm_image2.jpeg"]],
      ["pp-hinge-design", "PP-hinge.xlsm_image4.png", ["PP-hinge.xlsm_image3.png"]],
      [
        "snap-design",
        "Snap-design.xlsm_image8.png",
        ["Snap-design.xlsm_image2.png", "Snap-design.xlsm_image3.png"],
      ],
    ];

    for (const [slug, retained, removed] of retainedHdImages) {
      expect(imagesFor(slug)).toContain(retained);
      expect(imagesFor(slug)).not.toEqual(expect.arrayContaining(removed));
    }
    expect(imagesFor("lap-joint-design-standard")).toContain("Lap-joint.xlsm_image3.png");
    expect(imagesFor("snap-design")).toContain("Snap-design.xlsm_image10.png");
  });

  it("adapts every tooling baseline to the shared article format", () => {
    expect(baselineToolingPages).toHaveLength(baselineStandards.length);
    expect(baselineToolingPages.every((page) => page.page_type === "tooling_baseline")).toBe(true);
    expect(baselineToolingPages.every((page) => page.sections.length > 0)).toBe(true);
    expect(baselineToolingPages.every((page) => page.sections[0]?.table)).toBe(true);
    expect(new Set(baselineToolingPages.map((page) => page.slug)).size).toBe(baselineToolingPages.length);
  });

  it("keeps table-based tooling data exact and removes generated boilerplate", () => {
    const handring = baselineToolingPages.find((page) => page.slug === "tooling-baseline-handring");
    expect(handring?.title).toBe("Handring");
    expect(handring?.sections[0]?.title).toBe("Handring Tool Reference");
    expect(handring?.sections[0]?.table?.rows).toHaveLength(13);

    const renderedText = baselineToolingPages
      .flatMap((page) => page.sections)
      .map((section) => `${section.title} ${section.content}`)
      .join("\n");
    expect(renderedText).not.toContain("Standard Overview");
    expect(renderedText).not.toContain("Source workbook:");
    expect(renderedText).not.toContain("Confidence: high");
    expect(renderedText).not.toContain("Source review: Not required");
    expect(renderedText).not.toContain("/rag-assets/");
  });

  it("renders each generated accessory standard as one short checklist table", () => {
    const earring = baselineToolingPages.find((page) => page.slug === "tooling-baseline-earring");
    expect(earring?.sections[0]?.title).toBe("Checklist");
    expect(earring?.sections[0]?.table?.columns).toEqual(["", "Checklist"]);
    expect(earring?.sections[0]?.table?.rows.length).toBeGreaterThan(5);
    expect(earring?.sections[0]?.table?.rows[0]?.[0]).toBe("☐");
    expect(earring?.sections[0]?.table?.rows.flat().join(" ")).toContain("sharp");
    expect(earring?.sections.filter((section) => section.type === "design_rule")).toHaveLength(0);
    const visuals = earring?.sections.find((section) => section.title === "Visual References");
    expect(visuals?.image_references[0]).toContain("/thumbnails/");
    expect(visuals?.image_original_references?.[0]).toContain("/original/");
    expect(visuals?.image_captions?.every(Boolean)).toBe(true);
  });

  it("searches tooling checkpoints and keeps visual references web-ready", () => {
    expect(searchBaselineToolingPages("earring").some((page) => page.title.includes("Earring"))).toBe(true);
    expect(searchBaselineToolingPages("sharp point").some((page) => page.title === "Earring")).toBe(true);
    const images = baselineToolingPages.flatMap((page) =>
      page.sections.flatMap((section) => section.image_references),
    );
    expect(images.length).toBeGreaterThan(0);
    expect(images.every((image) => image.startsWith("/rag-assets/"))).toBe(true);
  });

  it("contains a complete, evidence-linked AI extraction of the accessory workbook", () => {
    expect(accessoryToolingAiDatabase.sheet_count).toBe(18);
    expect(accessoryToolingAiDatabase.model).toBe("gpt-5.6-sol");
    expect(accessoryToolingAiDatabase.image_occurrence_count).toBeLessThan(81);
    expect(accessoryToolingAiDatabase.standards).toHaveLength(18);

    const checkpointIds = accessoryToolingAiDatabase.standards.flatMap((standard) =>
      standard.checkpoints.map((checkpoint) => checkpoint.id),
    );
    const imageIds = new Set(
      accessoryToolingAiDatabase.standards.flatMap((standard) =>
        standard.images.map((image) => image.image_id),
      ),
    );
    const referencedImageIds = accessoryToolingAiDatabase.standards.flatMap((standard) =>
      standard.checkpoints.flatMap((checkpoint) =>
        checkpoint.evidence
          .filter((evidence) => evidence.source_type === "image")
          .map((evidence) => evidence.reference),
      ),
    );

    expect(new Set(checkpointIds).size).toBe(checkpointIds.length);
    expect(referencedImageIds.every((imageId) => imageIds.has(imageId))).toBe(true);
    expect(accessoryToolingAiDatabase.standards.every((standard) => {
      const requirements = standard.checkpoints.map((checkpoint) =>
        checkpoint.requirement.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
      );
      return new Set(requirements).size === requirements.length;
    })).toBe(true);
    expect(imageIds.has("IMG-051")).toBe(false);
    expect(imageIds.has("IMG-054")).toBe(false);
    expect(imageIds.has("IMG-070")).toBe(false);
    expect(imageIds.has("IMG-071")).toBe(false);
  });
});
