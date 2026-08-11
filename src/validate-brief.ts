import type { AnalysisFacts } from "./types.js";

export interface ValidationResult {
  ok: boolean;
  failures: string[];
}

/**
 * ADR-002 in practice: the model's narrative is untrusted input. Before the
 * briefing is accepted, verify it against the computed facts. This gate cannot
 * prove every sentence true, but it rejects the failure modes that matter:
 * invented SKUs, missing or re-ordered recommendations, a phase-out SKU pitched
 * as a reorder, and missing required sections.
 */
export function validateBriefing(narrative: string, facts: AnalysisFacts): ValidationResult {
  const failures: string[] = [];
  const knownSkus = facts.metrics.map((m) => m.sku);

  // 1. Required sections, in order.
  const sections = [
    "## The month in one paragraph",
    "## What sold",
    "## Stock risk",
    "## Reorder decisions",
    "## Watch list",
    "## The one tension",
  ];
  let cursor = 0;
  for (const s of sections) {
    const at = narrative.indexOf(s.slice(0, 14), cursor); // prefix match tolerates heading tail variations
    const exact = narrative.indexOf(s, cursor);
    if (exact === -1 && at === -1) failures.push(`Missing or out-of-order section: "${s}"`);
    else cursor = Math.max(exact, at);
  }

  // 2. No invented SKU names: any "MGO <number>" or "Bioactive Blend <word>" mentioned
  //    must resolve to a known SKU.
  const mgoMentions = narrative.match(/MGO\s*\d+\+?/g) ?? [];
  for (const mention of new Set(mgoMentions)) {
    const num = mention.replace(/[^\d]/g, "");
    if (!knownSkus.some((s) => s.includes(`MGO ${num}+`))) {
      failures.push(`Narrative mentions unknown SKU strength: "${mention}"`);
    }
  }
  // A known strength with a size the catalog doesn't sell ("MGO 850+ 100g") is
  // still an invented SKU — check the full strength+size combination.
  const mgoSizeMentions = narrative.match(/MGO\s*\d+\+\s*\d+\s?k?g/g) ?? [];
  for (const mention of new Set(mgoSizeMentions)) {
    const m = mention.match(/MGO\s*(\d+)\+\s*(\d+\s?k?g)/)!;
    if (!knownSkus.some((s) => s.includes(`MGO ${m[1]}+ ${m[2].replace(/\s/, "")}`))) {
      failures.push(`Narrative mentions a size variant that does not exist: "${mention}"`);
    }
  }
  // Capitalized word only: "Bioactive Blend Focus" is an invented SKU, but
  // "Bioactive Blend launch/family/portfolio" is legitimate collective prose
  // (a v1 run was falsely rejected for exactly this).
  const blendMentions = narrative.match(/Bioactive Blend\s+[A-Z][A-Za-z]+/g) ?? [];
  for (const mention of new Set(blendMentions)) {
    if (!knownSkus.some((s) => mention.startsWith(s.slice(0, mention.length)) || s.startsWith(mention))) {
      failures.push(`Narrative mentions unknown SKU: "${mention}"`);
    }
  }

  // 3. Every ranked reorder SKU must appear in the reorder section, in rank order.
  const ranked = facts.recommendations
    .filter((r) => r.priorityRank !== null)
    .sort((a, b) => a.priorityRank! - b.priorityRank!);
  const reorderStart = narrative.indexOf("## Reorder decisions");
  const watchStart = narrative.indexOf("## Watch list");
  const reorderSection =
    reorderStart !== -1 ? narrative.slice(reorderStart, watchStart === -1 ? undefined : watchStart) : "";
  let lastIdx = -1;
  for (const rec of ranked) {
    const shortName = rec.sku.replace("Manuka Honey ", "");
    const idx = reorderSection.indexOf(shortName);
    if (idx === -1) {
      failures.push(`Ranked reorder SKU missing from reorder section: ${rec.sku}`);
    } else if (idx < lastIdx) {
      failures.push(`Reorder ranking order violated at: ${rec.sku}`);
    } else {
      lastIdx = idx;
    }
  }

  // 4. The phase-out SKU must never be presented as a reorder decision.
  const phaseOut = facts.metrics.find((m) => m.isPhaseOut);
  if (phaseOut) {
    const rec = facts.recommendations.find((r) => r.sku === phaseOut.sku);
    const inReorderSection = reorderSection.includes("Propolis");
    if (rec?.action !== "REORDER_NOW" && inReorderSection) {
      failures.push(`Phase-out SKU appears inside the reorder decisions section: ${phaseOut.sku}`);
    }
    if (!/propolis/i.test(narrative)) {
      failures.push("Phase-out SKU never mentioned — the Propolis tension is required content.");
    }
  }

  return { ok: failures.length === 0, failures };
}
