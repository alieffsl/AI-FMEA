export type NormalizationResult = {
  normalizedFamily: string;
  matchedPattern: string;
  score: number;
};

const FAMILY_RULES: Array<{ family: string; patterns: RegExp[] }> = [
  {
    family: "Sunglass",
    patterns: [/sun\s*glass/i, /sunglass/i, /glasses/i, /eyewear/i, /thin\s*frame/i],
  },
  {
    family: "Bag Cover",
    patterns: [/bag[-\s]*cover/i, /bag\s*lid/i, /cover.*bag/i],
  },
  {
    family: "Dog Body",
    patterns: [/dog\s*body/i, /body\s*lt/i, /body\s*rt/i],
  },
  {
    family: "Dog Tail",
    patterns: [/dog\s*tail/i, /\btail\b/i, /tail[-\s]*body/i],
  },
  {
    family: "Dog Head",
    patterns: [/dog\s*head/i, /head\s*ft/i, /head\s*front/i],
  },
  {
    family: "Dog Bag",
    patterns: [/dog\s*bag/i, /pet\s*bag/i],
  },
  {
    family: "Shoes",
    patterns: [/\bshoe\b/i, /\bshoes\b/i, /footwear/i, /sole/i],
  },
  {
    family: "Bag",
    patterns: [/\bbag\b/i, /strap/i, /handle/i, /pouch/i],
  },
  {
    family: "Hair Clip",
    patterns: [/hair\s*clip/i, /\bclip\b/i, /hinge\s*clip/i],
  },
  {
    family: "Torso",
    patterns: [/\btorso\b/i, /body\s*shell/i, /upper\s*body/i],
  },
  {
    family: "Bodice",
    patterns: [/\bbra\b/i, /\bbodice\b/i, /body\s*wear/i],
  },
  {
    family: "Holder",
    patterns: [/vum\s*holder/i, /\bholder\b/i, /clip/i, /bracket/i],
  },
  {
    family: "Accessory",
    patterns: [/accessor/i, /insert/i, /small\s*part/i],
  },
];

export function compactText(value: string | number | undefined | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizeToolDescription(description: string): NormalizationResult {
  const cleaned = compactText(description);

  for (const rule of FAMILY_RULES) {
    const pattern = rule.patterns.find((candidate) => candidate.test(cleaned));
    if (pattern) {
      return {
        normalizedFamily: rule.family,
        matchedPattern: pattern.source,
        score: rule.family.toLowerCase() === cleaned ? 100 : 90,
      };
    }
  }

  const title = cleaned
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return {
    normalizedFamily: title || "Unknown",
    matchedPattern: "fallback",
    score: title ? 45 : 0,
  };
}

export function normalizeMaterial(value: string | undefined): string {
  const cleaned = compactText(value);

  if (!cleaned) return "";
  if (cleaned.includes("abs")) return "ABS";
  if (cleaned.includes("pc")) return "PC";
  if (cleaned.includes("pp")) return "PP";
  if (cleaned.includes("tpe")) return "TPE";
  if (cleaned.includes("pom")) return "POM";
  if (cleaned.includes("pvc")) return "PVC";
  if (cleaned.includes("hips")) return "HIPS";
  if (cleaned.includes("nylon") || cleaned.includes("pa")) return "PA";

  return cleaned.toUpperCase();
}

export function normalizeGateType(value: string | undefined): string {
  const cleaned = compactText(value);

  if (!cleaned) return "";
  if (cleaned.includes("sub")) return "Sub gate";
  if (cleaned.includes("pin")) return "Pin gate";
  if (cleaned.includes("edge") || cleaned.includes("side")) return "Edge gate";
  if (cleaned.includes("hot")) return "Hot runner";
  if (cleaned.includes("film") || cleaned.includes("fan")) return "Fan gate";
  if (cleaned.includes("tab")) return "Tab gate";

  return cleaned
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getRpnBucket(rpn: number | null | undefined): "Low" | "Medium" | "High" | "Critical" {
  if (!rpn || Number.isNaN(rpn)) return "Low";
  if (rpn >= 36) return "Critical";
  if (rpn >= 27) return "High";
  if (rpn >= 9) return "Medium";
  return "Low";
}
