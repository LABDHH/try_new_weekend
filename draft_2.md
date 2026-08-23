# Weekend Trip Planner — Analysis & Build Plan

## Context

The intent doc describes a website that turns a short question flow into a grounded 2–3 day road-trip itinerary, with Gemini reasoning over real Maps data. The doc explicitly asks for PM-level pushback rather than literal implementation, so this plan leads with what I'd change and why, then lays out the build.

Decisions taken from the user: build market-agnostic but test against India origins; consolidate vibe+focus into one tag grid while keeping explicit date/time pickers; treat this as a low-volume MVP and don't over-engineer for API quota.

Three research findings materially changed the architecture (sources at the bottom):

1. **`reviews` and `reviewSummary` are the Enterprise + Atmosphere SKU** — 1,000 free calls/month, $40/1k. A field mask is billed at the *highest* tier it touches.
2. **Nearby Search (New) can return `rating`, `userRatingCount`, `priceLevel`, `regularOpeningHours` and even `reviews` inline** — up to 20 places per call, billed as one call. Getting quality signal from *search* rather than per-place *Details* is ~20x cheaper for the same data.
3. **There is no Google API for "what towns are within a 3-hour drive?"** Nearby Search caps at a 50km radius. The doc's pipeline step 3 assumes a call that doesn't exist.

   Follow-up finding: the 50km ceiling binds less than it first appears. Three mechanisms exist, and only one is hard-capped:

   | Mechanism | Radius limit | Results |
   |---|---|---|
   | Nearby Search `locationRestriction` circle | **Hard 50km** | 20, no pagination |
   | Text Search `locationBias` circle | 50km, but **soft** — results may fall outside | 60 via pagination |
   | Text Search `locationRestriction` **rectangle** | **No cap at all** | 60 via pagination |

   The rectangle is the escape hatch, and it is what the wide-area destination fallback uses. But the real answer is that searching from the origin was always wrong: 20 results across a 300km area are arbitrary and useless for day-planning. The radius limit and the usefulness limit point the same way — move the search centre to the destination.

---

## What I'd Change From the Draft

### 1. Destination discovery is the real hole (doc step 3)

"Find a broad pool of candidate destinations within the drive-time radius" reads like one API call. It isn't one, and Nearby Search's 50km radius cap means it can't even be approximated for a 3–5 hour drive.

**Fix — generate then verify.** Gemini proposes 8–12 candidate destinations from world knowledge ("weekend getaways from Bangalore"), then every candidate is ground-truthed before it can survive:

- Geocode each name → anything that doesn't resolve dies.
- Haversine sanity check against `hours × 100 km/h` → absurd suggestions die before spending Route Matrix elements.
- **One** Route Matrix call, 1 origin × ~12 destinations = 12 elements (the `TRAFFIC_AWARE_OPTIMAL` cap is 100), with the user's real departure time → anything over the drive-time cap dies.

Hallucinated towns cannot reach the itinerary, because only geocoded, drive-time-verified destinations proceed. This *strengthens* the doc's core principle rather than weakening it: Gemini still makes every judgment call, and Google's data still owns every fact.

### 2. "Don't pre-filter in code" is right in spirit, wrong in absolute form

The doc's instinct — taste decisions belong to Gemini, not to keyword matching — is correct and worth protecting. But "hand Gemini everything unfiltered" actively *hurts* itinerary quality, not just cost. 300 places × 5 reviews each is roughly 1,500 review blobs; Flash reasons measurably worse across that much noise than over a tight, well-chosen payload. The free tier is Flash-only as of 2026 (Pro moved behind billing), so payload discipline is a quality lever, not just a budget one.

The useful distinction:

| Belongs in code (mechanical) | Belongs to Gemini (judgment) |
|---|---|
| Dedupe by place ID | Which café suits a "rustic & cozy" couple |
| Drop `businessStatus != OPERATIONAL` | Whether 4.2/8,000 beats 4.8/40 |
| Drop rating < 3.5 **when** `userRatingCount > 50` | Whether to spend the afternoon indoors |
| Cap reviews at 2–3 per place | Sequencing, pacing, what to cut |
| Tag `sparse_data: true` under 30 ratings | Which destination wins overall |

Nothing in the left column is a taste call. Every one is a data-hygiene floor.

### 3. Split Gemini into three calls, and fetch reviews *after* the shortlist

The doc pulls full review data for every place in the pool upfront. Inverting this is better on all three axes — cost, Flash's reasoning quality, and output quality:

- **Call 1 — Ideation:** propose candidate destinations (no Maps data needed yet).
- **Broad pool:** Nearby Search **Enterprise** across 3 destinations × 5 categories = 15 calls → ~300 places with rating, count, price level, hours. No reviews yet.
- **Call 2 — Pick & shortlist:** Gemini picks the destination and shortlists ~20–25 places with an intended role each (anchor / meal / coffee / evening / stay). Rating + count is the primary trust signal here anyway — which is what the doc itself argues.
- **Enrich:** Place Details **Enterprise + Atmosphere** for those ~20 finalists only → `reviewSummary`, `reviews`, `editorialSummary`.
- **Call 3 — Compose:** sequence the finalists into a day-by-day plan, now with rich review colour for exactly the places that made the cut.

Reviews load for ~20 places instead of ~300, and they load for the places that actually matter.

### 4. Weather should re-sequence the itinerary, not eliminate destinations

The doc treats weather as a destination-selection input. The far better product behaviour: a rainy Saturday doesn't kill a destination, it moves the museum to Saturday and the trail to Sunday. This is the single most differentiating behaviour in the product — it's the thing a thoughtful friend does that a generic itinerary generator never does. Weather only vetoes a destination outright on genuine safety grounds (storm warnings, snow closures).

### 5. Opening hours are the most common way AI itineraries embarrass themselves

Scheduling dinner at a place that closes at 6pm destroys trust instantly. `regularOpeningHours` must be in the pool payload, and the prompt must require every stop's proposed time to be checked against them. Cheap to do, disproportionate credibility payoff.

### 6. A 30-second spinner will lose users

The pipeline is geocode → Gemini → geocode ×N → route matrix → weather ×3 → 15 Places calls → Gemini → Places details ×20 → Gemini. Realistically 25–45 seconds. The doc doesn't address latency at all.

**Fix:** stream stage updates over SSE and narrate the work — "Found 9 places within 3 hours…", "Checking Saturday's weather in Coorg…", "Building your Saturday…". Showing the work converts dead waiting time into visible credibility.

### 7. Never return an empty state

The doc has no answer for "nothing good within radius." Options in order: widen the radius one bucket and say so plainly; or present the best available with an honest caveat. The app should always return something, and always explain the compromise it made.

### 8. Add shareable trip links

People plan weekends with other people. Persisting each itinerary to Supabase and serving it at `/trip/[id]` is nearly free once Supabase is in play for caching, and it's the only organic distribution loop this product gets. Read-only, no accounts — consistent with the doc's MVP constraints.

---

## What Actually Makes a Generated Itinerary Good

This is the rubric the prompts get graded against.

**Restraint over comprehensiveness.** 4–5 stops per day, not 10. Real weekends have slack. An over-packed itinerary is the clearest tell of a generated one.

**Anchor + flex.** One must-do anchor per day, the rest explicitly optional. Removes the military-schedule feel and survives contact with a slow morning.

**Pacing that accounts for reality.** Drive time between stops, meals at meal times, and a bias toward one neighbourhood per block rather than criss-crossing a town.

**"Why" in the user's own words.** "Since you said no beaches" beats "this is a lovely spot." Every justification must cite a specific answer the user gave. Generic praise is a failure, not a neutral outcome.

**Honesty markers build more trust than confidence.** "Only 40 reviews, so this one's a bit of a gamble" reads as a friend. Silent uncertainty reads as a brochure.

**Friction-removers.** Booking-needed flags, "closed Mondays," "cash only," parking notes — mined from hours and reviews. This is the highest-value content per token in the whole output.

**Tone: knowledgeable friend, not travel brochure.** Explicitly ban "nestled," "hidden gem," "vibrant tapestry," "a feast for the senses." Short declarative sentences.

**Plan first, reasoning on demand.** One line of "why this destination" at the top to earn trust immediately; per-stop reasoning collapsed behind a tap. The doc asks how much explanation — the answer is that the plan is the product and the reasoning is the receipt.

### Conflict precedence (encoded explicitly in the prompt)

When signals disagree, resolve in this order:

1. **Hard feasibility** — drive time fits the window, place is open, weather isn't dangerous. Non-negotiable.
2. **Who's going** — a family with a toddler cannot do the 6-hour hike, regardless of rating.
3. **Explicit avoid-list** from the open-text answer.
4. **Weather–activity fit** — resolved by re-sequencing (see #4 above).
5. **Vibe / focus match.**
6. **Rating quality.**
7. **Budget** — shapes which options get picked, rarely vetoes.

The tiebreak rule: prefer the signal that would *ruin* the trip if violated over the one that merely disappoints.

---

## Final Question Flow (8 questions)

Per the user's decision: vibe+focus merged, dates kept explicit.

1. **Starting city** — Places Autocomplete
2. **Leaving at** — date + time picker → feeds `departureTime` for traffic-aware ETA
3. **Back by** — date + time picker → defines the window; no separate "how many days"
4. **Max one-way drive** — `<1.5h` / `1.5–3h` / `3–5h` / `5h+`, with buckets that can't fit the chosen window disabled and explained
5. **Who's going** — Solo / Couple / Friends / Family with kids (moved earlier: highest personalization value per tap, and drop-off rises with depth)
6. **What's the weekend for** — one grid, pick up to 3: `Scenic & slow` `Food & drink` `Nature & hikes` `Culture & history` `Nightlife` `Luxe & pampered` `Rustic & cozy` `Offbeat & local` `Just switching off`
7. **Budget** — Keep it cheap / Comfortable / Treat myself
8. **Anything you're craving or want to avoid?** — optional free text, last

Note on #4: the drive-time cap should be validated against the trip window, not just collected. A Sat 8am → Sat 10pm day trip cannot support a 5-hour each-way drive, and the UI should say so rather than letting Gemini discover it later.

---

## Architecture

**Stack:** Next.js (App Router) + TypeScript on Vercel, Tailwind + Framer Motion, Supabase Postgres, Zod for validation. All Maps and Gemini calls in route handlers — keys never reach the client.

```
src/
  app/
    page.tsx                    question flow
    trip/[id]/page.tsx          itinerary (shareable)
    api/plan/route.ts           SSE streaming pipeline
  lib/
    maps/  geocode | places | routes | weather   one thin client each
    gemini/ ideate | shortlist | compose         one prompt module each
    pipeline/ orchestrate.ts, hygiene.ts, validate.ts
    schema/ answers.ts, pool.ts, itinerary.ts    Zod, shared client/server
  components/
    flow/  QuestionShell, TextQ, DateTimeQ, ChoiceQ, TagGridQ, ProgressBar
    trip/  DayTimeline, StopCard, WhyChip, WeatherStrip
```

**Each Maps client is a standalone module with a matching probe script** (`npm run probe:places`) that hits the live API and writes its JSON to `fixtures/`. This satisfies the doc's "independently testable before chaining" requirement and, more importantly, lets the whole pipeline run offline against fixtures — you'll iterate the Gemini prompts dozens of times, and doing that against recorded fixtures instead of live APIs is the single biggest velocity win in this build.

**Output validation is code, not prompt.** Zod-parse Gemini's response, then assert every returned place ID exists in the input pool. Anything invented is dropped, and one retry is issued with the validation errors fed back. A prompt saying "never invent" is a request; this is a guarantee.

**Design direction.** Editorial travel-magazine rather than SaaS form: warm sand/off-white ground instead of white, large serif display type carrying each question, one saturated accent, full-bleed single-question screens, horizontal slide transitions (motion = travel). The itinerary renders as a vertical timeline with a time gutter, not a grid of cards — it should read like a well-made day plan, not a search results page.

---

## Build Sequence

**Phase 1 — Ground truth first.** The four Maps clients + probe scripts, verified live against a real origin. Confirms field masks, SKU behaviour, and the Weather/Routes edge cases before anything depends on them.

**Phase 2 — Pipeline over fixtures.** Destination ideation + verification, the pool fetch, hygiene, and the three Gemini prompts — all runnable headless from a JSON answers file. This is where itinerary quality is actually won or lost, so it happens before any UI exists.

**Phase 3 — Question flow UI.** `QuestionShell` owns transitions, progress, and back-navigation; each question type is a slot component. State in a single typed reducer matching the Zod answers schema.

**Phase 4 — Streaming + itinerary page.** SSE wiring, staged progress narration, timeline rendering, `reviewSummary` attribution (`reviewsUri` link + "Summarized with Gemini" — a Google requirement, correctly flagged in the doc).

**Phase 5 — Supabase + share links.** Persist itineraries, serve `/trip/[id]`, simple exact-match cache on (origin + answers + week).

**Phase 6 — Edge cases and polish.** Empty-radius fallback, no-forecast fallback, conflicting-preference handling, mobile pass.

---

## Risks and Edge Cases

| Risk | Handling |
|---|---|
| **Weather forecast only reaches 10 days** — a trip planned 3 weeks out has none | Detect and degrade: skip weather-based sequencing, say "too far out for a forecast" rather than silently omitting it |
| **`departureTime` cannot be in the past for DRIVE mode** | Validate at question time; block past datetimes in the picker |
| **Gemini invents a place despite instructions** | Server-side ID validation against the pool + one repair retry (above) |
| **Nearby Search has no pagination — hard cap of 20 per call** | Accept 20/category/destination; use Text Search where a broader pool is genuinely needed |
| **Free tier is Flash-only; Pro moved behind billing in 2026** | Payload discipline is mandatory, which the three-call split already delivers |
| **Sparse Places data outside metros** | Tag `sparse_data`, let Gemini flag uncertainty in the output rather than hiding it |
| **Free-tier rate limit is ~10 RPM** | 3 Gemini calls/trip ≈ 3 concurrent trips. Fine at MVP volume; noted, not engineered around |

**Cost, briefly** (global rates; India bills up to 70% less). The binding SKU is Nearby Search Enterprise at 15 calls/trip against 1,000 free/month ≈ 66 free trips/month, then ~$0.90/trip all-in. The naive "Place Details per place" reading of the doc would be ~$7.50/trip and ~3 free trips/month. Per the user's steer this isn't engineered around further — but the architecture that's cheaper here is also the one that reasons better, so nothing is traded away for it.

---

## Verification

- `npm run probe:*` — each Maps client hits the live API and dumps a fixture; confirms field masks and SKU tiers empirically rather than from docs.
- `npm run plan:local -- fixtures/answers-bangalore.json` — full pipeline headless, no UI, no browser.
- **Itinerary quality harness:** 6 saved answer-sets chosen to stress the rubric — family-with-kids, solo offbeat, treat-myself couple, rainy forecast, sparse-data origin, impossible radius. Each run is graded against the rubric above (stop count, hours respected, reasoning cites user answers, no banned brochure phrasing, no invented places). This is the real test suite; unit tests cover hygiene and validation.
- Manual: two live end-to-end runs from different origins, on mobile viewport, checking `reviewSummary` attribution renders correctly.

---

## Sources

- [Place Data Fields (New) — SKU tiers](https://developers.google.com/maps/documentation/places/web-service/data-fields)
- [Nearby Search (New) — field mask, 20-result cap](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
- [Places usage & billing — highest-tier billing rule](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
- [Maps Platform pricing — per-SKU free tiers](https://developers.google.com/maps/billing-and-pricing/pricing)
- [March 2025 billing changes](https://developers.google.com/maps/billing-and-pricing/march-2025)
- [Compute Route Matrix — 100-element cap for TRAFFIC_AWARE_OPTIMAL](https://developers.google.com/maps/documentation/routes/compute_route_matrix)
- [computeRoutes — departureTime constraints](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes)
- [Weather API coverage](https://developers.google.com/maps/documentation/weather/coverage)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
