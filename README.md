# Manukora S&OP Briefing Automation

Practical brief submission — AI Automation Engineer. Raimundo Yáñez Doren.

Turns the monthly S&OP spreadsheet into an executive briefing a non-technical reader can
act on in 5 minutes. **Part 1** (this repo's code) is the working build; **Part 2** is the
Morning Intelligence Brief architecture in
[`docs/part2-morning-intelligence-brief.md`](docs/part2-morning-intelligence-brief.md).

## The one design decision everything follows from

**The LLM never does arithmetic.** All math — trends, runway simulations, revenue
opportunity, reorder ranking — is computed by tested TypeScript (`src/metrics.ts`,
`src/recommend.ts`) and handed to Claude as a facts JSON. Claude's only job is narrative
judgment: turning verified numbers into a story with business reasoning. Its output is then
**validated in code** (`src/validate-brief.ts`) before it is accepted: invented SKUs,
missing or re-ordered recommendations, or a phase-out SKU pitched as a reorder all reject
the draft. One bounded retry with the failure list, then the pipeline fails loudly rather
than shipping an unverified briefing.

Why: an executive who catches one wrong number in a briefing stops trusting all of them.
LLMs are excellent at narrative and unreliable at arithmetic, so the boundary goes exactly
there. I use the same pattern in production and wrote it up before this exercise:
[ADR-002 — validating LLM output at the boundary](https://github.com/ryanezdoren-gif/engineering-notes/blob/main/adr-002-llm-output-validation-handoff.md).

```
data/mock_data.csv
      │  strict loader (src/data.ts — schema-checked, fails loudly)
      ▼
tested math (src/metrics.ts) ──► ranked decisions (src/recommend.ts)
      │  facts JSON — the only numbers that exist
      ▼
Claude claude-opus-5 (src/generate-brief.ts) — narrative only
      │
      ▼
validation gate (src/validate-brief.ts) ──► retry once with failures ──► fail loudly
      │ pass
      ▼
output/sop-briefing.md  +  machine-generated appendix (never model-written)
```

## Setup and run

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm test        # 15 tests: math, business rules, every data trap
pnpm typecheck
pnpm analyze     # deterministic analysis only — table + output/facts.json, no API needed
pnpm brief       # full briefing via Claude (prompt v2) → output/sop-briefing.md
pnpm brief -- --prompt v1   # reproduce the first-attempt prompt for comparison
```

`pnpm brief` needs an Anthropic API key in `.env` (gitignored):

```
ANTHROPIC_API_KEY=sk-ant-...
```

The mock data lives at [`data/mock_data.csv`](data/mock_data.csv), verbatim from the brief.
The final generated briefing is committed at [`output/sop-briefing.md`](output/sop-briefing.md).

## Assumptions and judgment calls

Every number in the briefing traces to one of these rules:

- **Trend** = geometric mean month-over-month growth across the SKU's window — M1→M4
  normally, **M2→M4 for Bioactive Blends** (launched mid-January; a trend against a partial
  launch month would overstate growth).
- **Current sell-through baseline** = M4 combined Shopify + Amazon units (per the brief);
  all stock is pooled.
- **Runway** is not `stock ÷ demand`. It's a month-by-month simulation: demand compounds at
  the trend rate, and a confirmed order lands at the start of its arrival month.
  `Order_Arrival_Months = 0` means **no order exists** — it never means "arrives now".
  A simple static cover figure is also computed for comparison.
- **Revenue opportunity** = retail price × projected next-month demand (M4 baseline grown
  one month at trend), per the brief's definition.
- **Reorder decision rule:** runway below target cover → `REORDER_NOW`; clears target by
  under a month → `REORDER_SOON` (the next PO belongs in this cycle); healthy stock but a
  channel warning → `MONITOR`. Reorders are **ranked by revenue opportunity**, not
  stock-cover severity — with declining-demand tensions flagged instead of blindly
  re-ranked.
- **Propolis Tincture 30ml** (Q2 2026 phase-out): reorder only if cover drops below 30
  days; otherwise a projected stockout inside the phase-out window is flagged as a tension
  — demand is *growing* on a product being sunset — not acted on.
- **MGO 1700+ 100g** carries a 3-month target cover (premium price, longer supplier lead
  time).
- **Latest-month channel dips are surfaced separately from the trend.** A first-to-last
  growth number smooths over a reversal: MGO 100+ 250g is up overall, but Amazon fell
  404 → 388 in March. The engine flags that channel signal rather than extrapolating the
  healthy total.

## How I verified it

- **15 unit tests** (`tests/metrics.test.ts`) lock down the math and every special rule:
  growth endpoints hand-computed, the Bioactive M2→M4 window, runway edge cases (order
  arriving before/after stockout, `Order_Arrival_Months = 0` semantics), the exact
  `REORDER_NOW` set and its revenue ranking, the Propolis monitor-plus-tension outcome, the
  MGO 1700+ 3-month target, the Amazon-dip flag, and the revenue-opportunity formula.
- **Hand-checked the headline numbers** against the CSV before trusting the engine (e.g.
  MGO 514+ 500g: 392 units M4 combined, 780 on hand, no order → ~1.75 months runway
  against a 2-month target, ≈ $34.3K/month of revenue exposed → priority 1).
- **The narrative is validated against the facts** on every run (`src/validate-brief.ts`)
  — the briefing you read cannot contain a SKU or a ranking the engine didn't produce.
- The appendix table in the output is generated by code after validation; the model never
  writes it.

## Prompt stack and how it evolved

Both prompt versions are in [`prompts/`](prompts/) and both runs are reproducible
(`pnpm brief -- --prompt v1` / `v2`). The honest iteration record — what v1 got wrong in
its actual output, what v2 changed and why, and where the AI helped vs. where it was wrong
— is in [`prompts/CHANGELOG.md`](prompts/CHANGELOG.md).

One structural point worth stating here: the math was moved out of the prompt and into
tested code **before v1 ever ran** — the prompt never had a chance to own the numbers.
The v1→v2 iteration is therefore about narrative discipline, not arithmetic correctness.

## AI usage

Built with Claude Code throughout — design discussion, implementation, tests, and this
document — as the brief expects. Every commit is co-authored accordingly. The judgment
calls above (simulation vs. static cover, the Propolis tension framing, the channel-dip
flag, the validation-gate design) are the part I'd defend in a review.
