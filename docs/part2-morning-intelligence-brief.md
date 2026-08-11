# Part 2 — Morning Intelligence Brief: architecture

## What I would build

A daily brief with a hard cap of **three items**, delivered as a Slack DM the executive
reads in under a minute. Same architectural spine as Part 1: deterministic collectors and
math decide *what is true and what matters*; the LLM only writes the narrative; a
validation gate checks the prose against the computed facts before anything is sent.

**Sources: Shopify + Amazon Seller Central.** Shopify Admin GraphQL API (orders, refunds,
inventory levels) and Amazon SP-API (Orders, FBA inventory). These two cover ~all of
Manukora's DTC revenue and complete the pooled-inventory picture — the same stock position
Part 1 reasons about, now at daily granularity. Klaviyo or a reviews platform would be the
third source once the loop is trusted; adding them on day one is scope creep.

## How it works

1. **Collect (hourly).** A scheduled worker (Trigger.dev cron; GitHub Actions works too)
   snapshots both APIs into Postgres (Supabase): raw responses plus normalized
   orders/refunds/inventory tables keyed by timestamp. Hourly collection means the morning
   send never depends on a live API call succeeding at send time.
2. **Detect (deterministic).** A diff engine compares the last 24h against a same-weekday
   trailing 4-week median — daily e-commerce is too weekday-seasonal for a plain daily
   average. Candidate signals: revenue outside its normal band, a SKU velocity spike or
   drop, stockout-risk acceleration (Part 1's runway simulation re-run on daily
   sell-through), refund-rate spikes, and Shopify/Amazon divergence on the same SKU.
3. **Select (ranked, capped).** Each signal gets a score = dollar impact × decision
   urgency. Top three, hard cap. Anything below threshold accrues to a weekly digest
   instead of leaking into the daily brief. If nothing clears the bar, the brief honestly
   says "nothing needs a decision today" — a quiet day stated plainly is what makes the
   loud days credible.
4. **Narrate + validate.** Claude (`claude-opus-5`) turns the selected facts JSON into
   ≤200 words: what changed, what needs a decision, what direction it's trending. Same
   hard rules as Part 1 — no arithmetic, only provided figures, exact SKU names — and the
   same code-side validation gate with one bounded retry. If validation fails twice, the
   send contains the machine-generated fact list labeled "auto-summary unavailable".
   Never a skipped day, never unvalidated prose.
5. **Deliver.** Slack DM, with an explicit "data as of" stamp. Email fallback if Slack
   posting fails.

## The timezone problem

Decouple *generation* from *delivery*, and never infer location. Each recipient's send is
scheduled at 6:30am in their timezone as **Slack already reports it** — the `tz` field on
their own profile, which their client keeps current when they travel. That is data they
already share with the workspace, so reading it is not surveillance; there is no calendar
scraping, no read-receipt tracking, no wake-time prediction. A one-line override
(`/brief tz America/Los_Angeles`, `/brief pause`) covers the edge cases, and if the lookup
fails the send falls back to 6:00am Pacific/Auckland. Because generation is cheap
(~$0.05), the brief is generated *at send time* from the latest snapshots — an exec waking
in Los Angeles gets their morning's data, not a stale 6am-NZ artifact, and the "as of"
stamp makes freshness visible. Not creepy, not unreliable, not overbuilt: one scheduled
function and one profile field Slack maintains anyway.

## Cost at Manukora scale

Shopify and SP-API calls are free within rate limits at this volume. Supabase ~$25/mo,
Trigger.dev free tier to ~$10/mo, Claude ~$0.05/brief/recipient ≈ $2–5/mo. **Under
$50/month all-in.** First trustworthy version: about a week of build, with the detect
thresholds expected to need two or three weeks of tuning against reality.

## Failure modes

- **Source API down / stale:** the brief still sends, with an explicit "Amazon data stale
  since 14:00 UTC" line. Visible absence beats silent omission — an exec must never act on
  a number that quietly excludes a channel.
- **Schema drift:** strict parsers fail loudly to a builder alert channel, never to the
  executive.
- **LLM hallucination:** the validation gate, bounded retry, and labeled deterministic
  fallback. The worst possible failure is a wrong number in an executive's morning read —
  which is why numbers never come from the model.
- **Duplicate or missed sends:** idempotency key per (recipient, local date), plus a
  heartbeat alert if no brief has gone out by expected time + 30 minutes.

## Keeping it useful instead of noisy

The three-item cap and significance thresholds do most of the work; honest quiet days do
the rest. Monthly, review the thresholds against which items the executive actually acted
on — by asking them, not by tracking them.
