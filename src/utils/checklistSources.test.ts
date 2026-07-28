import { describe, expect, it } from "vitest";
import type { FmeaDraftRow } from "../types/fmea";
import {
  countChecklistSources,
  getChecklistSourceKinds,
  getChecklistSourceLabel,
  getStandardSourceTitles,
} from "./checklistSources";

type Entry = NonNullable<FmeaDraftRow["checklistEntries"]>[number];

const baseEntry: Entry = {
  id: "entry-1",
  tool_description_normalized: "Headband",
  tool_category: null,
  failure_mode: "Weldline",
  sub_concern_index: 1,
  concern: "Multiple gates can create a weld line.",
  recommendation: "Use a single-gate design.",
  supporting_record_count: 0,
  supporting_record_ids: [],
  supporting_failure_ids: [],
};

describe("checklist source provenance", () => {
  it("treats legacy entries without metadata as Previous FMEA", () => {
    expect(getChecklistSourceKinds(baseEntry)).toEqual(["historical_fmea"]);
    expect(getChecklistSourceLabel(baseEntry)).toBe("Previous FMEA");
  });

  it("preserves both historical and MEC Product Standard provenance", () => {
    const entry: Entry = {
      ...baseEntry,
      source_types: ["historical_fmea", "product_standard"],
      supporting_standard_refs: [
        {
          source_type: "product_standard",
          source_id: "headband-design",
          title: "Headband Design Guidelines",
        },
        {
          source_type: "product_standard",
          source_id: "headband-design",
          title: "Headband Design Guidelines",
        },
      ],
    };

    expect(getChecklistSourceKinds(entry)).toEqual([
      "historical_fmea",
      "product_standard",
    ]);
    expect(getChecklistSourceLabel(entry)).toBe(
      "Previous FMEA + MEC Product Standard",
    );
    expect(getStandardSourceTitles(entry)).toEqual([
      "Headband Design Guidelines",
    ]);
  });

  it("counts each source represented by combined entries", () => {
    expect(
      countChecklistSources([
        baseEntry,
        {
          ...baseEntry,
          id: "entry-2",
          source_types: ["baseline_standard"],
        },
        {
          ...baseEntry,
          id: "entry-3",
          source_types: ["historical_fmea", "product_standard"],
        },
      ]),
    ).toEqual({
      historical_fmea: 2,
      product_standard: 1,
      baseline_standard: 1,
    });
  });
});
