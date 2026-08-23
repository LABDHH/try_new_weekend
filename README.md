# Weekend Trip Planner

Answer eight questions, get a 2–3 day road trip grounded in real traffic,
weather, and place data. Gemini makes every judgment call; Google's APIs own
every fact.

## Setup

```bash
npm install
cp .env.example .env.local   # add your two keys
npm run dev
```

Requires **Node 22+** (`.nvmrc` pins it — `nvm use`). Node 20 works today but
`@supabase/supabase-js` warns and will drop support.

### Keys

Both are server-side only. Neither is prefixed `NEXT_PUBLIC_`, and neither ever
reaches the browser.

- `GEMINI_API_KEY` — Google AI Studio. The free tier is Flash-only.
- `GOOGLE_MAPS_API_KEY` — one key with **Geocoding, Places (New), Routes,
  Weather** enabled.

Two setup gotchas that cost people an afternoon:

1. **Do not restrict the Maps key by HTTP referrer.** Referrer restrictions are
   for browser keys and reject server-side calls with a confusing
   `REQUEST_DENIED`. Restrict by *API* instead.
2. **Billing must be attached** to the Cloud project, even for free-tier usage.

Supabase is optional. With `SUPABASE_URL` blank the app runs end to end;
you just don't get share links or caching. To enable it, run
[`supabase/schema.sql`](supabase/schema.sql) and fill in the two vars.

## Testing without a browser

The pipeline is deliberately headless-first, because itinerary quality is where
this product is won and you'll iterate the prompts dozens of times.

```bash
npm run selftest      # 40 guardrail checks. No keys, no network.
npm run probe:models  # what Gemini models your key can actually call
npm run probe:geocode "Bangalore, India"
npm run probe:places  "Coorg, Karnataka"
npm run probe:routes  "Bangalore, India"
npm run probe:weather "Coorg, Karnataka"
npm run plan:local fixtures/answers-bangalore.json   # whole pipeline, no UI
```

Probes write live responses to `fixtures/`, so after one real run you can
iterate offline without burning quota.

## How it works

The hard part is that **no Google API answers "which towns are within a 3-hour
drive?"** Nearby Search caps at a 50km radius. So the pipeline splits that into
two questions answered by different mechanisms:

**1. Which towns are worth going to?** — no Places call at all.

```
Gemini proposes ~12 destinations
  → geocode each          names that don't resolve die
  → haversine ceiling     hours × 100km/h; absurd picks die
  → ONE Route Matrix call 12 elements (cap is 100), real traffic at your
                          stated departure time; anything over your cap dies
```

Hallucinated towns can't reach the itinerary — they die at verification.

**2. What's good in that town?** — the search centre has moved.

Coorg is 250km away, but once it's a verified candidate we geocode *Coorg* and
search from there with a 25km radius. The 250km never enters a Places call.

Then: pool → hygiene → Gemini shortlists ~24 → reviews fetched **only** for
those finalists → Gemini composes. Loading reviews after the shortlist rather
than before is cheaper *and* produces better output, since the composing model
sees rich detail on 24 places instead of thin detail on 300.

## Guardrails

| Layer | Where | What it does |
|---|---|---|
| Input validation | `schema/answers.ts` | Past dates, impossible windows, infeasible drive/window combos rejected at the door |
| Injection defence | `gemini/sanitize.ts` | Neutralises instruction-shaped text in user input **and in Google reviews** |
| Grounding | `gemini/compose.ts` | Every returned place id must exist in the real pool — code, not prompt |
| Semantic checks | `verifyItinerary` | Day count, dates, one anchor/day, no overlapping times, no duplicate stops |
| Repair loop | `gemini/client.ts` | Failures fed back as specific corrections, capped at 2 attempts |
| Spend ceiling | `budget.ts` | Per-request caps on Maps calls, Gemini calls, and wall clock |
| Rate limit | `api/plan/route.ts` | 5 requests/min per IP |

`npm run selftest` verifies all of these offline.

## Layout

```
src/lib/maps/       one thin client per API, each independently probeable
src/lib/gemini/     ideate | shortlist | compose, plus sanitize + client
src/lib/pipeline/   orchestrate, hygiene (mechanical), pack (context)
src/lib/schema/     Zod — one source of truth for validation AND generation
src/components/     flow/ (8 questions), trip/ (timeline)
scripts/            probes + plan:local + selftest
```
