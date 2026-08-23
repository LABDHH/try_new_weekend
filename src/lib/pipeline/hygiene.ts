import { LIMITS } from "../config";
import type { PoolPlace } from "../schema/places";

/**
 * MECHANICAL HYGIENE — deliberately not taste filtering.
 *
 * The line this file walks: judgment about which places suit a traveller
 * belongs to the model. Data-quality floors belong here. Nothing below is an
 * opinion about a place; each rule is about whether the DATA is usable.
 *
 *   dedupe            — the same place returned by two category searches
 *   rating floor      — only applied where the vote count makes it conclusive
 *   sparse flagging   — kept, but marked, so the model can flag uncertainty
 *
 * A 3.2-star restaurant with 800 ratings is not "not to my taste", it is
 * reliably bad, and spending context on it makes the itinerary worse.
 */
export function applyHygiene(places: PoolPlace[]): {
  kept: PoolPlace[];
  dropped: { duplicates: number; lowRated: number; unnamed: number };
} {
  const byId = new Map<string, PoolPlace>();
  let duplicates = 0;
  let lowRated = 0;
  let unnamed = 0;

  for (const place of places) {
    if (!place.id || !place.name || place.name === "Unnamed place") {
      unnamed++;
      continue;
    }

    if (byId.has(place.id)) {
      duplicates++;
      continue;
    }

    // Only drop on rating when there are enough votes to be confident. A 3.0
    // from four people is noise, not evidence.
    const confident =
      (place.ratingCount ?? 0) >= LIMITS.MIN_RATINGS_FOR_CONFIDENCE &&
      place.rating !== undefined;
    if (confident && place.rating! < LIMITS.MIN_RATING) {
      lowRated++;
      continue;
    }

    byId.set(place.id, {
      ...place,
      sparseData: (place.ratingCount ?? 0) < LIMITS.SPARSE_DATA_THRESHOLD,
    });
  }

  return {
    kept: [...byId.values()],
    dropped: { duplicates, lowRated, unnamed },
  };
}

/**
 * Confidence-weighted score used only for context packing, never for selection.
 *
 * A Bayesian shrink toward the mean: a 4.9 from 12 people scores below a 4.4
 * from 3,000, which is the same logic the model is told to apply. Using the
 * same rule here means packing does not fight the model's own reasoning.
 */
export function confidenceScore(p: PoolPlace): number {
  const rating = p.rating ?? 3.5;
  const count = p.ratingCount ?? 0;
  const prior = 3.9;
  const weight = 40;
  return (rating * count + prior * weight) / (count + weight);
}
