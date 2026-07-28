import { describe, expect, it } from "vitest";
import { cdiNewTools } from "../data/cdiMockData";
import { demoNewTools, failureTaxonomy, historicalFmeaCases } from "../data/fmeaMockData";
import { buildFailureCountsByFamily, consolidateToolRows, generateFmeaSuggestions, scoreHistoricalCase } from "./fmeaEngine";
import { normalizeToolDescription } from "./normalization";

describe("normalization", () => {
  it("normalizes common tooling labels", () => {
    expect(normalizeToolDescription("dog body Lt").normalizedFamily).toBe("Dog Body");
    expect(normalizeToolDescription("Torso-Ft / Torso-Rr").normalizedFamily).toBe("Torso");
    expect(normalizeToolDescription("Bag-cover").normalizedFamily).toBe("Bag Cover");
    expect(normalizeToolDescription("thin frame glasses").normalizedFamily).toBe("Sunglass");
  });
});

describe("fmeaEngine", () => {
  it("scores exact family/material/gate closed evidence above high-confidence threshold", () => {
    const sunglass = demoNewTools.find((item) => item.toolDescription === "Sunglass")!;
    const evidence = historicalFmeaCases.find((item) => item.id === "case-jmv17-019")!;
    const score = scoreHistoricalCase(sunglass, evidence, buildFailureCountsByFamily(historicalFmeaCases));

    expect(score.score).toBeGreaterThanOrEqual(80);
    expect(score.reasons.join(" ")).toContain("Similar part design");
  });

  it("consolidates repeated CDI rows by tool number before draft generation", () => {
    const draftRows = consolidateToolRows(cdiNewTools);
    const torso = draftRows.find((item) => item.toolNo === "JLK25-Q501-01")!;

    expect(draftRows).toHaveLength(4);
    expect(torso.toolDescription).toBe("Torso-Ft / Torso-Rr");
    expect(torso.refPartNumber).toBe("002, 003");
    expect(torso.partWeightG).toBe(18.4);
  });

  it("generates only evidence-backed suggestions with taxonomy RPN values", () => {
    const suggestions = generateFmeaSuggestions(demoNewTools, historicalFmeaCases, failureTaxonomy);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((item) => item.evidence.length > 0)).toBe(true);
    expect(suggestions.every((item) => item.rpn === item.severity * item.occurrence * item.detection)).toBe(true);
    expect(suggestions.some((item) => item.toolNo === "T-001" && item.failure === "Fail abuse")).toBe(true);
  });

  it("generates CDI suggestions with recommended actions and validations", () => {
    const suggestions = generateFmeaSuggestions(consolidateToolRows(cdiNewTools), historicalFmeaCases, failureTaxonomy);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((item) => item.evidence.length > 0)).toBe(true);
    expect(suggestions.every((item) => item.recommendedActions.length > 0)).toBe(true);
    expect(suggestions.every((item) => item.validations.length > 0)).toBe(true);
    expect(suggestions.some((item) => item.projectCode === "JLK25" && item.toolDescription === "Hair-clip")).toBe(true);
    expect(suggestions.some((item) => item.toolDescription === "Torso-Ft / Torso-Rr")).toBe(true);
    expect(suggestions.every((item) => item.recommendedActions.every((action) => !action.startsWith("Historical FMEA action")))).toBe(
      true,
    );
  });
});
