import type { Budget } from "../budget";
import { CORE_CATEGORIES } from "../config";
import { driveBandFit, DRIVE_BUCKETS, type Answers } from "../schema/answers";
import type { DayWeather, Destination, PoolPlace } from "../schema/places";
import { shortlistSchema, type Shortlist } from "../schema/itinerary";
import { generateStructured } from "./client";
import { BALANCE_RULES, renderProfile } from "./profile";

const SYSTEM = `
You decide where someone should actually go, and which specific places are worth
their limited time. You are working from real Google Maps data — ratings, rating
counts, price levels and opening hours.

You may only refer to places by the exact id given to you. Never invent one.

# Score before you choose

Score EVERY candidate destination on all six dimensions before picking one.
Do not decide first and justify afterwards — work through the scores and let
them lead you. If a lower-scoring option is still the right call, say why.

  driveFit     Does the real, traffic-aware drive time land in the band they
               asked for? A destination well SHORT of the band scores low, not
               high. They chose that range on purpose. Overshooting slightly is
               better than undershooting badly.
  interestFit  How well does it serve their stated interests, and especially
               anything they wrote in their own words?
  varietyFit   Can it support a full trip — something to see, something
               outdoors, somewhere good to eat, somewhere to sit still? A place
               that only does one thing scores low unless that one thing is
               exactly what they asked for.
  weatherFit   How workable is the actual forecast for these dates? Rain is a
               sequencing problem, not a veto. Only genuine danger vetoes.
  groupFit     Right for who is actually going, in pacing and in kind.
  dataQuality  Are there enough well-rated real places here to build a real
               plan? A beautiful place with six usable entries is a bad bet.

# Then select places

How to weigh the place data:
- rating combined with ratingCount is the primary trust signal. 4.3 across
  8,000 ratings is far stronger evidence than 4.9 across 25.
- sparseData means too few ratings to trust alone. You may still pick it if it
  fills a real gap, but expect to flag the uncertainty.
- priceLevel should track their budget answer. It is a preference, not a veto.
- Prefer places that are distinctive to this area over generic chains, unless
  the traveller's own words point the other way.
- Do not pick five near-identical places. A trip needs contrast.

${BALANCE_RULES}
`.trim();

/**
 * STAGE 2 — pick the destination and shortlist finalists.
 *
 * Runs on rating/count/price/hours only. Reviews are deliberately NOT loaded
 * yet: they are the expensive SKU, and at ~300 places they would swamp the
 * context. Rating plus rating-count is the primary trust signal anyway.
 */
export async function shortlistPlaces(
  answers: Answers,
  destinations: Destination[],
  pool: PoolPlace[],
  weather: Map<string, DayWeather[]>,
  budget: Budget,
): Promise<Shortlist> {
  const validIds = new Set(pool.map((p) => p.id));
  const band = DRIVE_BUCKETS[answers.driveBucket];

  const destBlocks = destinations
    .map((d) => {
      const days = weather.get(d.name) ?? [];
      const forecast = days.length
        ? days
            .map((w) =>
              w.available
                ? `    ${w.date}: ${w.summary}, ${Math.round(w.minC ?? 0)}-${Math.round(w.maxC ?? 0)}C, rain ${w.precipitationPercent ?? 0}%`
                : `    ${w.date}: no forecast available this far out`,
            )
            .join("\n")
        : "    (no forecast)";

      const hours = (d.driveSeconds ?? 0) / 3600;
      const fit = driveBandFit(answers, d.driveSeconds ?? 0);
      const verdict =
        fit === 1
          ? "IN the band they asked for"
          : hours < band.minHours
            ? `SHORT of the band — they asked for ${band.minHours}-${band.maxHours}h and this is only ${hours.toFixed(1)}h`
            : `OVER the band by ${(hours - band.maxHours).toFixed(1)}h`;

      const counts = CORE_CATEGORIES.map((c) => {
        const n = pool.filter((p) => p.category === c.key).length;
        return `${c.key}:${n}`;
      }).join(" ");

      return [
        `- ${d.name}${d.region ? ` (${d.region})` : ""}`,
        `    real drive: ${hours.toFixed(1)}h each way (${Math.round((d.driveMeters ?? 0) / 1000)} km) — ${verdict}`,
        `    why proposed: ${d.pitch ?? "n/a"}`,
        d.offers?.length ? `    offers: ${d.offers.join(", ")}` : null,
        d.seasonNote ? `    season: ${d.seasonNote}` : null,
        `    pool coverage across all candidates: ${counts}`,
        forecast,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  // Compact one-line-per-place rendering, grouped by category so gaps in
  // coverage are visible at a glance rather than buried in a flat list.
  const byCategory = new Map<string, PoolPlace[]>();
  for (const p of pool) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }

  const poolBlock = [...byCategory.entries()]
    .map(([cat, list]) => {
      const rows = list
        .map((p) => {
          const bits = [
            `${p.id} | ${p.name}`,
            p.rating ? `${p.rating}/5 (${p.ratingCount ?? 0})` : "unrated",
          ];
          if (p.priceLevel) bits.push(p.priceLevel.replace("PRICE_LEVEL_", "").toLowerCase());
          if (p.sparseData) bits.push("sparseData");
          return `  ${bits.join(" ")}`;
        })
        .join("\n");
      return `[${cat}] (${list.length})\n${rows}`;
    })
    .join("\n\n");

  const prompt = `
${renderProfile(answers)}

## Candidate destinations — drive times below are REAL and traffic-aware
${destBlocks}

## Available places, grouped by category
Format: id | name rating (number of ratings) priceLevel flags
${poolBlock}

## Your task

1. Score all ${destinations.length} candidates on the six dimensions. Show every score.
2. Pick ONE destination. Remember they asked for ${band.minHours}-${band.maxHours}
   hours of driving — a much closer option is not a safer choice, it is a
   different trip from the one they asked for. Only prefer a shorter drive if
   the in-band options are genuinely poor.
3. Say briefly why the others lost.
4. From the chosen destination only, shortlist 25-35 place ids. A later step
   builds a full hour-by-hour plan from exactly this list, so a thin or
   lopsided shortlist guarantees a thin or lopsided trip. Include:
     - AT LEAST 8 experience places (attractions, nature, activities, viewpoints)
     - 6-8 places to eat, across meals and price points
     - 3+ cafes or casual stops
     - 2+ places to stay, if this is an overnight trip
     - anything genuinely distinctive to the area
5. In balanceCheck, state how many experience places versus food places you
   picked, and confirm experiences outnumber food.
6. Return ONLY ids that appear above, copied exactly.
`.trim();

  return generateStructured({
    stage: "shortlist",
    system: SYSTEM,
    prompt,
    schema: shortlistSchema,
    budget,
    temperature: 0.35,
    verify: (v) => {
      const issues: string[] = [];

      const bad = v.placeIds.filter((id) => !validIds.has(id));
      if (bad.length) {
        issues.push(
          `These place ids are not in the supplied pool: ${bad.slice(0, 5).join(", ")}. Use only ids from the list.`,
        );
      }

      const known = v.placeIds.filter((id) => validIds.has(id));
      const chosen = known.map((id) => pool.find((p) => p.id === id)!).filter(Boolean);
      const experiences = chosen.filter((p) => p.category === "attraction" || p.category === "nature").length;
      const food = chosen.filter((p) => p.category === "food" || p.category === "cafe").length;

      // The single most common failure: a shortlist that is mostly restaurants,
      // because restaurants dominate the source data by sheer count.
      if (chosen.length >= 10 && experiences < 6) {
        issues.push(
          `Only ${experiences} experience places (attractions/nature) against ${food} food places. Pick at least 8 experiences — this trip is not a food tour.`,
        );
      }

      if (!destinations.some((d) => d.name.toLowerCase() === v.destinationName.toLowerCase())) {
        issues.push(
          `"${v.destinationName}" is not one of the candidates. Choose from: ${destinations.map((d) => d.name).join(", ")}.`,
        );
      }

      return issues;
    },
  });
}
