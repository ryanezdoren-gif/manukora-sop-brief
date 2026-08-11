# Fresh-clone run transcript

The submission checklist asks for "any screenshots or screen recordings that help us
understand the workflow." This is the text equivalent, captured verbatim from a **cold
clone of this public repo** on a separate machine path (2026-08-11) — the exact sequence
a reviewer would run. Nothing below was edited beyond stripping ANSI color codes.

## 1. Clone and install

```
$ git clone https://github.com/ryanezdoren-gif/manukora-sop-brief.git reviewer-test
Cloning into 'reviewer-test'...

$ pnpm install
+ typescript 5.9.3
+ vitest 3.2.7
Done in 659ms using pnpm v11.14.0
```

## 2. Tests and typecheck

```
$ pnpm test
 ✓ tests/metrics.test.ts (15 tests) 4ms
 ✓ tests/validate-brief.test.ts (8 tests) 3ms

 Test Files  2 passed (2)
      Tests  23 passed (23)

$ pnpm typecheck
$ tsc --noEmit        # clean, no output
```

## 3. Deterministic analysis (no API key required)

```
$ pnpm analyze
M4 revenue: $337,288.2 (M3: $311,313.24)
┌─────────┬─────────────────────────────────┬───────────┬───────────┬────────────────┬────────────────────┬────────────────┬──────┬────────────┐
│ (index) │ SKU                             │ M4 demand │ growth/mo │ cover (simple) │ runway (w/ orders) │ action         │ rank │ rev opp/mo │
├─────────┼─────────────────────────────────┼───────────┼───────────┼────────────────┼────────────────────┼────────────────┼──────┼────────────┤
│ 0       │ 'Manuka Honey MGO 100+ 250g'    │ 1032      │ '3.8%'    │ 6.2            │ 7                  │ 'MONITOR'      │ ''   │ '$26,764'  │
│ 1       │ 'Manuka Honey MGO 263+ 250g'    │ 1604      │ '6.5%'    │ 4.55           │ 5.33               │ 'NO_ACTION'    │ ''   │ '$59,763'  │
│ 2       │ 'Manuka Honey MGO 263+ 500g'    │ 684       │ '7.1%'    │ 2.49           │ 2.22               │ 'REORDER_SOON' │ 5    │ '$40,308'  │
│ 3       │ 'Manuka Honey MGO 514+ 250g'    │ 940       │ '7.3%'    │ 3.62           │ 4.37               │ 'NO_ACTION'    │ ''   │ '$50,440'  │
│ 4       │ 'Manuka Honey MGO 514+ 500g'    │ 392       │ '9.3%'    │ 1.99           │ 1.75               │ 'REORDER_NOW'  │ 1    │ '$34,316'  │
│ 5       │ 'Manuka Honey MGO 850+ 250g'    │ 536       │ '6.8%'    │ 3.54           │ 4.22               │ 'NO_ACTION'    │ ''   │ '$40,034'  │
│ 6       │ 'Manuka Honey MGO 850+ 500g'    │ 244       │ '9.9%'    │ 1.8            │ 1.58               │ 'REORDER_NOW'  │ 2    │ '$29,477'  │
│ 7       │ 'Manuka Honey MGO 1700+ 100g'   │ 300       │ '10.2%'   │ 2.8            │ 3.32               │ 'REORDER_SOON' │ 6    │ '$19,857'  │
│ 8       │ 'Propolis Tincture 30ml'        │ 168       │ '11.9%'   │ 1.37           │ 1.2                │ 'MONITOR'      │ ''   │ '$6,578'   │
│ 9       │ 'Bioactive Blend Immunity 250g' │ 528       │ '11.6%'   │ 2.27           │ 3.02               │ 'NO_ACTION'    │ ''   │ '$23,554'  │
│ 10      │ 'Bioactive Blend Energy 250g'   │ 388       │ '12.2%'   │ 1.91           │ 1.62               │ 'REORDER_NOW'  │ 3    │ '$17,396'  │
│ 11      │ 'Bioactive Blend Recovery 250g' │ 364       │ '13.2%'   │ 1.68           │ 1.42               │ 'REORDER_NOW'  │ 4    │ '$16,476'  │
└─────────┴─────────────────────────────────┴───────────┴───────────┴────────────────┴────────────────────┴────────────────┴──────┴────────────┘

Facts written to output/facts.json
```

Identical figures to the committed [`output/facts.json`](../output/facts.json) — the
engine is deterministic.

## 4. Full briefing generation (needs `ANTHROPIC_API_KEY` in `.env`)

```
$ pnpm brief
Generating briefing (prompt v2, attempt 1)...
Briefing written to .../reviewer-test/output/sop-briefing.md (validated on attempt 1).
```

**What this run showed.** The fresh generation passed the validation gate on attempt 1
and cited exactly the figures in the facts JSON — but with different prose than the
committed [`output/sop-briefing.md`](../output/sop-briefing.md), which is expected: the
narrative layer is the one non-deterministic stage, and the gate plus the facts contract
are what hold it to the numbers. One observation in the same class as the residuals
already logged in [`prompts/CHANGELOG.md`](../prompts/CHANGELOG.md): this run converted
runway months into loose calendar language ("lands in the back half of May" for a
1.75-month runway from end of March). Qualitative, decision-neutral, and exactly the
kind of drift the facts-only rule bounds — but worth naming rather than hiding.
