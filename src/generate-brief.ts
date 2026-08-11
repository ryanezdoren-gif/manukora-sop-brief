import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { loadSkuRows } from "./data.js";
import { computeMetrics } from "./metrics.js";
import { recommend } from "./recommend.js";
import { validateBriefing } from "./validate-brief.js";
import type { AnalysisFacts } from "./types.js";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// Minimal .env loader — avoids a dependency for one variable.
const envPath = here("../.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set. Put it in .env (gitignored) or the environment.");
  process.exit(1);
}

const promptVersion = process.argv.includes("--prompt")
  ? process.argv[process.argv.indexOf("--prompt") + 1]
  : "v2";

// Recompute facts in-process so the briefing can never run on a stale facts file.
const rows = loadSkuRows(here("../data/mock_data.csv"));
const metrics = rows.map(computeMetrics);
const recommendations = recommend(metrics);
const m4Revenue = Math.round(rows.reduce((s, r, i) => s + metrics[i].combined[3] * r.retailPriceUsd, 0));
const m3Revenue = Math.round(rows.reduce((s, r, i) => s + metrics[i].combined[2] * r.retailPriceUsd, 0));
const facts: AnalysisFacts = {
  generatedFor: "March 2026 (M4)",
  metrics,
  recommendations,
  totals: {
    m4RevenueUsd: m4Revenue,
    m3RevenueUsd: m3Revenue,
    bestSellersByM4Revenue: metrics
      .map((m, i) => ({ sku: m.sku, rev: m.combined[3] * rows[i].retailPriceUsd }))
      .sort((a, b) => b.rev - a.rev)
      .slice(0, 3)
      .map((x) => x.sku),
    fastestGrowers: [...metrics].sort((a, b) => b.growthRate - a.growthRate).slice(0, 3).map((m) => m.sku),
    decliners: metrics.filter((m) => m.growthRate < 0).map((m) => m.sku),
  },
};

const template = readFileSync(here(`../prompts/prompt-${promptVersion}.md`), "utf8");
const prompt = template.replace("{{FACTS_JSON}}", JSON.stringify(facts, null, 2));

const client = new Anthropic();
const MAX_ATTEMPTS = 2; // bounded retries, then fail loudly — same rule as ADR-002

async function generate(feedback: string | null): Promise<string> {
  const content = feedback
    ? `${prompt}\n\nYour previous draft failed automated validation against the computed facts:\n${feedback}\nRewrite the briefing correcting these problems. All other rules still apply.`
    : prompt;
  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 16000,
    messages: [{ role: "user", content }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason !== "end_turn") {
    throw new Error(`Generation did not complete normally: stop_reason=${message.stop_reason}`);
  }
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function appendix(): string {
  const lines = [
    "\n\n---\n\n## Appendix — machine-generated figures (not written by the model)\n",
    "| SKU | M4 demand | Growth/mo | Runway (mo, incl. orders) | Target | Action | Rank | Revenue opportunity/mo |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const m of metrics) {
    const r = recommendations.find((x) => x.sku === m.sku)!;
    lines.push(
      `| ${m.sku} | ${m.baselineDemand} | ${(m.growthRate * 100).toFixed(1)}% | ${m.runwayMonths} | ${r.targetMonthsCover} | ${r.action} | ${r.priorityRank ?? "—"} | $${Math.round(m.revenueOpportunity).toLocaleString("en-US")} |`,
    );
  }
  lines.push(
    `\nM4 revenue: $${m4Revenue.toLocaleString("en-US")} (M3: $${m3Revenue.toLocaleString("en-US")}). ` +
      "All figures computed by tested code (`src/metrics.ts`, `src/recommend.ts`); the narrative above was validated against them (`src/validate-brief.ts`).",
  );
  return lines.join("\n");
}

let narrative = "";
let attempt = 0;
let lastFailures: string[] = [];
for (attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log(`Generating briefing (prompt ${promptVersion}, attempt ${attempt})...`);
  narrative = await generate(lastFailures.length ? lastFailures.map((f) => `- ${f}`).join("\n") : null);
  const result = validateBriefing(narrative, facts);
  // Every raw draft is kept on disk, pass or fail — the iteration record must show
  // what the model actually produced, not only what survived the gate.
  mkdirSync(here("../output/attempts"), { recursive: true });
  const status = result.ok
    ? "PASSED validation"
    : `FAILED validation:\n${result.failures.map((f) => `  - ${f}`).join("\n")}`;
  writeFileSync(
    here(`../output/attempts/${promptVersion}-attempt-${attempt}.md`),
    `<!--\nRaw model output. Prompt ${promptVersion}, attempt ${attempt}. ${status}\n-->\n\n${narrative}\n`,
  );
  if (result.ok) break;
  lastFailures = result.failures;
  console.error(`Validation failed:\n${result.failures.map((f) => `  - ${f}`).join("\n")}`);
  if (attempt === MAX_ATTEMPTS) {
    console.error("Out of attempts — refusing to write an unvalidated briefing.");
    process.exit(1);
  }
}

mkdirSync(here("../output"), { recursive: true });
const outPath = here(`../output/sop-briefing${promptVersion === "v2" ? "" : `-${promptVersion}`}.md`);
writeFileSync(outPath, `${narrative}${appendix()}\n`);
console.log(`Briefing written to ${outPath} (validated on attempt ${attempt}).`);
