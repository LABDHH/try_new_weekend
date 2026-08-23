# Weekend Trip Planner — Project Intent

This is not a build order — it's what I'm trying to build. Think through the architecture, propose an execution plan, and flag anything that seems risky or worth reconsidering before writing code.

## What This Is

A website where a user enters their starting city, answers a short one-at-a-time question flow, and gets back a personalized 2-3 day weekend road trip itinerary — grounded in real traffic, weather, and place data, with Gemini acting as the reasoning engine that decides what actually goes into the trip.

## What I Already Have

- **Gemini API key** (Google AI Studio, free tier)
- **Google Maps Platform API key** — single key, will enable Geocoding, Places API (New), Routes API, and Weather API under one Cloud project/billing account (free tier, quota-capped)
- **GitHub account** (free)
- Able to create: **Vercel** account (hosting) and **Supabase** account (database) — not created yet, plan for their use

## Core Principle: Gemini Is the Decision-Making Brain

The backend's job is to gather real, broad, unfiltered data — candidate destinations, places (monuments, parks, cafes, restaurants, hotels), traffic, weather, ratings/review summaries. Gemini's job is to reason over all of it against the user's actual answers and decide what belongs in the itinerary, why, and in what order. Do not pre-filter candidates by simple keyword matching in backend code — that decision-making belongs to Gemini.

## The Question Flow (this defines the UI, not a form)

**Interaction model:** one question shown at a time, not a stacked form. Smooth transition between questions (slide/fade). A slim progress bar or step indicator at the top so the user always senses "almost done," reducing drop-off. Keep each screen visually minimal — the question, the input, a next button, nothing competing for attention.

1. **Starting city** — free text with Google Places Autocomplete
2. **Leaving at** — date + time picker (e.g. "Sat, 7:00 AM") — feeds Routes API `departure_time` for real traffic-aware ETA
3. **Need to be back by** — date + time picker (e.g. "Sun, 9:00 PM") — combined with #2 gives total trip window and implicitly defines trip length, so no separate "how many days" question is needed
4. **Max one-way drive time** — tap one bucket: `<1.5 hrs` / `1.5–3 hrs` / `3–5 hrs` / `5+ hrs`. This is strictly a road-trip app — no flight option, since flight routes/pricing/timing can't be reliably validated through available APIs, and keeping this ground-truth-able end to end matters more than covering every trip type
5. **Vibe/aesthetic** — tap 1-2: `Relaxed & scenic` / `Modern & luxe` / `Rustic & cozy` / `Buzzy & social` / `Offbeat & local`
6. **Trip mostly about** — tap 1-2: `Food & drink` / `Nature & outdoors` / `Culture & sightseeing` / `Nightlife` / `Just switching off`
7. **Who's going** — tap 1: `Solo` / `Couple` / `Friends` / `Family with kids` — meaningfully changes what gets selected (pacing, venue type, room configuration), shouldn't be dropped
8. **Budget level** — tap 1: `Keep it cheap` / `Comfortable` / `Treat myself`
9. **Anything specific you're craving or want to avoid?** — open text, optional, last. Placeholder hint like "dietary needs, mobility limits, no beaches, traveling with a toddler..." Catches long-tail preferences without needing more tap-questions.

## Design Direction

New, modern feel — not a generic template look. Avoid the obvious "centered card on white background with a blue button" default. Think through typography, spacing, and a distinct visual identity that fits a travel-planning product (evokes movement, discovery, weekend-away energy) rather than a generic SaaS form aesthetic. This applies to both the question flow and the final itinerary results page.

## Backend Data Pipeline (per submission)

1. **Geocode** starting city → lat/lng (Geocoding API)
2. **Determine trip length** from the leaving/return timestamps
3. **Find a broad, unfiltered pool of candidate destinations** within the selected drive-time radius, then for each candidate area pull places across categories: attractions/monuments, parks/nature, cafes, restaurants, hotels (Places API New) — pull enough per category that Gemini has real choices, don't narrow in code
4. **For every place in the broad pool, request full quality signal upfront:** `rating`, `userRatingCount`, `reviewSummary` (Google's own AI-generated review synthesis), and up to 5 raw `reviews`. Don't withhold this data to save quota and hand Gemini a thinner picture — the decision of whether a place is good enough to include in the itinerary, and how to weigh its rating/review signal against the user's specific answers, belongs entirely to Gemini. It needs the real data to make that call well. Use the APIs as needed to get there; don't compromise on data quality for the sake of saving a small number of free-tier calls.
5. **For 2-4 shortlisted candidate destination areas**, fetch traffic-aware travel time via Routes API using `routingPreference: TRAFFIC_AWARE_OPTIMAL`, `trafficModel: BEST_GUESS`, with `departure_time` set to the user's actual specified leaving time (and return time, for the trip back)
6. **Fetch 10-day weather forecast** per candidate area, pull the specific days matching the trip window (Weather API)
7. **Assemble one structured JSON payload**: all question answers, the full unfiltered place pool per candidate area (with ratings/review data), traffic-aware travel times, weather per day
8. **Send to Gemini** with instructions to:
   - Pick the best-fitting destination area given all constraints (drive time, weather, preferences)
   - From the real place pool, select and sequence specific stops that match vibe/focus/who's-going/budget — e.g. a family-with-kids trip shouldn't get a bar-crawl nightlife itinerary or a 6-hour hike; a "treat myself" budget should surface higher-end options from the pool
   - Weigh `rating` + `userRatingCount` as the primary trust signal (a strong average across thousands of ratings outweighs a couple of recent outlier reviews); use `reviewSummary`/reviews for specific color and genuinely useful flags (e.g. "gets very crowded on weekend afternoons"); flag uncertainty for places with very few total ratings
   - Build a coherent day-by-day flow (realistic pacing and sequencing, not a random shuffle of picks)
   - Justify each choice briefly against the user's specific answers
   - Use only real places/data from the payload — never invent a name, address, or fact not present in the given pool
   - Return structured JSON (day, ordered stops with type/name/address/why-it-fits, weather summary, travel note) so the frontend renders without parsing free text
9. **Cache the result in Supabase**, keyed by a hash of (origin + all answers + week number), so identical repeat searches within the same week don't burn API quota again

## Constraints and Guardrails

- All Google Maps + Gemini API calls happen server-side only — keys never touch the client
- Be aware that requesting Pro-tier fields (reviews/ratings) costs more of the free monthly allowance than Essentials-only fields, and monitor usage — but this is a cost-awareness note, not a license to withhold data from Gemini. Quality of the final itinerary comes first; manage quota through sensible engineering (caching, capping pool size sanely, monitoring dashboards) rather than by starving Gemini of the rating/review signal it needs to make good calls
- If displaying `reviewSummary` text in the UI, include the required attribution (link to `reviewsUri` + "Summarized with Gemini" disclosure text) — this is a Google requirement, not optional
- No user accounts, no login, no saved trips across sessions, no payment/booking integration, no native mobile app — MVP is a responsive website only

## What I Want From You (Claude Code)

Before writing code, think through and propose:
- Project structure and how you'd sequence the build (what to build/test first vs. last)
- How you'd structure the question-flow UI as its own reusable component system
- How you'd structure the backend pipeline so each API call is independently testable before chaining them together
- Any part of this that seems risky, likely to hit real-world friction (API quirks, rate limits, edge cases), or worth simplifying for a true first-pass MVP

## One More Thing — This Is a Draft, Not a Spec Handed Down to You

Everything above is just my own thinking as a non-expert founder sketching this out — not a finished design. I want you to actually think about this like a good PM would, not just implement it literally. Specifically:

- Push back on or improve anything above that a stronger product thinker would do differently
- Think through what actually makes a *good* generated itinerary — not just "technically correct," but genuinely useful and personalized: what should the Gemini prompt keep in mind, what tone/structure makes a response feel thoughtful rather than generic, how much explanation vs. how much just showing the plan, how to handle edge cases (e.g. no good destinations found within radius, conflicting preferences, sparse data for a place)
- Consider whether the question flow itself is asking the right things, in the right order, in the right way — and whether anything's missing that would meaningfully improve personalization without adding friction
- Think about how all the pieces (traffic, weather, ratings, reviews, preferences) should actually be weighed against each other when they conflict — e.g. a highly-rated spot with bad weather that day, or a great vibe-match that's right at the edge of the drive-time limit
- Propose whatever changes, additions, or simplifications you think would make this genuinely more robust and better-considered, before we start building

Use Plan Mode to work through all of this and present your thinking and proposed plan before writing any code.
