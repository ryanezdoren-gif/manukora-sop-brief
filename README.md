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
  channel warning → `MONITOR`. **Priority = urgency tier first, then revenue opportunity
  within the tier** — a SKU still above its cover target hasn't "needed" the reorder yet,
  so it doesn't outrank one that has. When that ordering hides money, the briefing says
  so explicitly: MGO 263+ 500g ranks 5th on urgency while carrying ~$40K/month, more than
  any `REORDER_NOW` SKU — and declining-demand tensions are flagged instead of blindly
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

## Tradeoffs

- **No fallback model, fail loudly.** After one bounded retry the pipeline refuses to
  write an unvalidated briefing and exits nonzero. Availability is traded for
  trustworthiness — a missing briefing is visible; a wrong one quietly erodes trust in
  every future one. The tested facts and machine appendix still stand on their own.
- **Geometric-mean growth instead of regression.** Four data points (three for Bioactive
  Blends) are too few to fit a curve honestly; the geometric mean matches multiplicative
  growth and is trivially verifiable by hand.
- **Runway simulated at monthly granularity** — the granularity of the data. Sub-month
  precision from monthly inputs would be false precision. The simple static cover figure
  is kept alongside for comparison.
- **Urgency tier outranks raw revenue** in reorder priority (see the decision rule
  above) — at the cost of a big-dollar `REORDER_SOON` SKU ranking below smaller
  `REORDER_NOW` ones. The briefing is required to surface that tension in prose rather
  than resolve it silently in either direction.
- **The validation gate is structural, not semantic.** It rejects invented SKUs, missing
  or re-ordered recommendations, and phase-out violations; it cannot prove every prose
  sentence true. That's exactly why every number originates in the facts JSON and the
  appendix is machine-generated — and why the gate is strict enough to occasionally
  false-reject and let the bounded retry absorb it, rather than lenient enough to let a
  bad briefing through.

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
- **The whole flow was re-run from a cold clone of this public repo** — install, tests,
  typecheck, analysis, and a fresh Claude generation (validated on attempt 1, same
  figures, different prose). The verbatim terminal transcript is
  [`docs/fresh-clone-run.md`](docs/fresh-clone-run.md), standing in for the checklist's
  "screenshots or screen recordings".
- **The final narrative was hand-checked line by line** against `output/facts.json` —
  every cited figure traces to the facts, including the "without inbound orders"
  counterfactuals (`runwayWithoutOrderMonths`). Two loose qualitative unit conversions
  were found and recorded in the changelog rather than hand-edited: generated output is
  never manually altered in this repo.

## Prompt stack and how it evolved

Both prompt versions are in [`prompts/`](prompts/), every attempt's raw output — including
rejected drafts — is preserved in [`output/attempts/`](output/attempts/), and both runs
are reproducible (`pnpm brief -- --prompt v1` / `pnpm brief`). The full iteration record
is [`prompts/CHANGELOG.md`](prompts/CHANGELOG.md); the short version:

- **v1** (naive: "write a briefing an executive can read in 5 minutes") produced a good
  document with three problems: it invented a different structure every run (so nothing
  could be validated), it did its own arithmetic ("up 8.3%", "$97,664 exposure" —
  hand-checked correct, but *unverified*), and it ran to ~1,100 words with nine tables.
  It also exposed a false positive in my validator ("Bioactive Blend launch" flagged as
  an invented SKU) — fixed with a regression test.
- **v2** fixed the structure, banned model arithmetic with executive rounding of provided
  figures, made consequence-first reasoning and both tensions explicit requirements, and
  removed the model's appendix. Its first run *still* summed four provided figures into
  one total — correctly, but unverifiably — so the sum was moved into the facts JSON and
  the briefing regenerated. If the narrative needs a number, the number must exist in
  the facts.
- **What I was wrong about:** my pre-run draft of the changelog predicted v1 would bury
  the decision and miss the planted tensions. It did neither. That draft was rewritten
  from the actual run evidence — observations, not predictions.

## AI usage

Built with Claude Code throughout — design discussion, implementation, tests, and this
document — as the brief expects. Every commit is co-authored accordingly. The judgment
calls above (simulation vs. static cover, the Propolis tension framing, the channel-dip
flag, the validation-gate design) are the part I'd defend in a review.
