import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeToolDescription } from "./normalizeToolDescription";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The normalizer exists in three copies because the frontend, the API server,
 * and the migration scripts compile under three different module systems.
 * The copies drifting apart is what caused the API to miss exact matches
 * against `fmea_knowledge_base.tool_description_normalized`, so the drift
 * itself is now a test failure.
 */
describe("normalizeToolDescription copies", () => {
  const copies = [
    "src/utils/normalizeToolDescription.ts",
    "server/normalizeToolDescription.ts",
    "migration/normalizeToolDescription.ts",
  ];

  it("are byte-identical across frontend, server, and migration", () => {
    const [reference, ...others] = copies.map((relativePath) => ({
      relativePath,
      source: readFileSync(repoRoot + relativePath, "utf8"),
    }));

    for (const copy of others) {
      expect(
        copy.source,
        `${copy.relativePath} has drifted from ${reference.relativePath}. ` +
          "Copy one file verbatim over the others, then re-run " +
          "`npm --prefix migration run normalize:populate` so the database " +
          "column matches the rules the API applies.",
      ).toBe(reference.source);
    }
  });
});

describe("normalizeToolDescription", () => {
  it("strips hyphen-separated tool number prefixes and preserves position suffixes", () => {
    expect(normalizeToolDescription("JJB33-001-torso-ft")).toBe("Torso FT");
    // Verified against production data: the stored column already held
    // "Kelly Big Bow Shoes", so a narrower Pattern A would have regressed it.
    expect(normalizeToolDescription("V6986-2879-Kelly-big-bow-shoes")).toBe("Kelly Big Bow Shoes");
    expect(normalizeToolDescription("SNAKE_BODY.FT")).toBe("Snake Body FT");
    expect(normalizeToolDescription("Snake-Body")).toBe("Snake Body");
    expect(normalizeToolDescription("Snake Body LT")).toBe("Snake Body LT");
    expect(normalizeToolDescription("Dog Body LT")).toBe("Dog Body LT");
  });

  // Pattern B and Pattern C were missing from the server copy, so any
  // description carrying a space-separated tool number failed to match.
  it("strips space-separated tool number prefixes", () => {
    expect(normalizeToolDescription("Jjb33 001 Torso Ft")).toBe("Torso FT");
    expect(normalizeToolDescription("Jtv75 001 Pet Toy")).toBe("Pet Toy");
    expect(normalizeToolDescription("Y7557 Bracelet")).toBe("Bracelet");
  });

  // COMPOUND_WORDS was missing from the server copy: the database stored
  // "Hair Clip" while the API looked up "Hairclip" and found nothing.
  it("maps known terms to their canonical display name", () => {
    // "hair clip" is genuinely two words, so it is the one entry that splits.
    expect(normalizeToolDescription("Hairclip")).toBe("Hair Clip");
    expect(normalizeToolDescription("HairClip")).toBe("Hair Clip");
  });

  // These are ordinary single words. An earlier version decomposed them into
  // "Head Band", "Neck Lace", "Back Pack" and the nonsensical "Ankle T", which
  // changed the join key against tool_description_normalized.
  it("does not split standard single words", () => {
    expect(normalizeToolDescription("headband")).toBe("Headband");
    expect(normalizeToolDescription("Necklace")).toBe("Necklace");
    expect(normalizeToolDescription("BACKPACK")).toBe("Backpack");
    expect(normalizeToolDescription("anklet")).toBe("Anklet");
    expect(normalizeToolDescription("earring")).toBe("Earring");
    expect(normalizeToolDescription("sunglasses")).toBe("Sunglasses");
    expect(normalizeToolDescription("bodysuit")).toBe("Bodysuit");
    expect(normalizeToolDescription("ponytail")).toBe("Ponytail");
  });

  it("merges confident plurals on the whole description only", () => {
    expect(normalizeToolDescription("accessories")).toBe("Accessory");
    expect(normalizeToolDescription("accessory")).toBe("Accessory");
    expect(normalizeToolDescription("arches")).toBe("Arch");
    expect(normalizeToolDescription("bracelets")).toBe("Bracelet");
    expect(normalizeToolDescription("shoes")).toBe("Shoe");
    // Deliberately not "Dog Leg": multi-word descriptions are left alone so a
    // qualifier is never silently dropped.
    expect(normalizeToolDescription("Dog Legs")).toBe("Dog Legs");
  });

  it("leaves unrecognised prefixes and short tokens intact", () => {
    expect(normalizeToolDescription("FP21009-TORSO FT")).toBe("Fp21009 Torso FT");
    expect(normalizeToolDescription("torso")).toBe("Torso");
    expect(normalizeToolDescription("arch")).toBe("Arch");
    expect(normalizeToolDescription("1f")).toBe("1f");
  });

  // The API normalizes whatever the client sends. If normalizing an already
  // normalized value changed it, the client and the database would disagree,
  // so callers must send the raw description and let the server normalize once.
  it("is idempotent for values that survive a first pass", () => {
    for (const raw of [
      "JJB33-001-torso-ft",
      "Snake Body LT",
      "Hairclip",
      "Jjb33 001 Torso Ft",
      "accessories",
      "torso",
    ]) {
      const once = normalizeToolDescription(raw);
      expect(normalizeToolDescription(once), `re-normalizing "${once}"`).toBe(once);
    }
  });

  it("returns Unknown for empty input", () => {
    expect(normalizeToolDescription(null)).toBe("Unknown");
    expect(normalizeToolDescription(undefined)).toBe("Unknown");
    expect(normalizeToolDescription("")).toBe("Unknown");
    expect(normalizeToolDescription("   ")).toBe("Unknown");
    expect(normalizeToolDescription("---")).toBe("Unknown");
  });
});
