import { LIMITS, PLACE_CATEGORIES } from "../config";
import type { PoolPlace } from "../schema/places";
import { confidenceScore } from "./hygiene";

/**
 * CONTEXT MANAGEMENT.
 *
 * There is a genuine tension here worth being honest about: trimming the pool
 * is closer to a judgment call than the hygiene rules are. It is done anyway,
 * because handing the model ~300 places measurably degrades its reasoning — the
 * "give it everything unfiltered" instinct produces a WORSE itinerary, not just
 * a more expensive one.
 *
 * Two rules keep this from becoming taste filtering:
 *   1. Category balance is preserved, so the model always has real choices in
 *      every category rather than a pool pre-narrowed toward one kind of trip.
 *   2. The ranking heuristic is the same confidence-weighted rating the model is
 *      told to apply, so packing never contradicts its own reasoning.
 */
export function packPool(places: PoolPlace[], limit: number = LIMITS.MAX_POOL_FOR_SHORTLIST): PoolPlace[] {
  if (places.length <= limit) return places;

  const byCategory = new Map<string, PoolPlace[]>();
  for (const p of places) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }

  for (const list of byCategory.values()) {
    list.sort((a, b) => confidenceScore(b) - confidenceScore(a));
  }

  // Round-robin across categories so no category is starved by a category that
  // simply returned more results.
  const out: PoolPlace[] = [];
  const cursors = new Map<string, number>();
  const categories = PLACE_CATEGORIES.map((c) => c.key).filter((k) => byCategory.has(k));

  while (out.length < limit) {
    let addedThisRound = false;
    for (const cat of categories) {
      if (out.length >= limit) break;
      const list = byCategory.get(cat)!;
      const i = cursors.get(cat) ?? 0;
      if (i < list.length) {
        out.push(list[i]);
        cursors.set(cat, i + 1);
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break;
  }

  return out;
}

/** Rough token estimate for logging context pressure. ~4 chars per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
