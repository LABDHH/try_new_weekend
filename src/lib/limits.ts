/**
 * Client-safe constants.
 *
 * Deliberately separate from config.ts: the question flow imports LIMITS via
 * the answers schema, and when these lived alongside the env schema the whole
 * server config — including the names of every secret — got bundled into the
 * client. No values ever leaked, but the shape of the server config did, and
 * that is a leak waiting to happen.
 */
/**
 * Every tunable in one place. These are deliberate product decisions, not
 * arbitrary numbers — the comments explain what breaks if you move them.
 */
export const LIMITS = {
  /** Gemini proposes this many destinations; most get eliminated by verification. */
  IDEATE_DESTINATIONS: 12,

  /** Route Matrix caps at 100 elements for TRAFFIC_AWARE_OPTIMAL. We stay far under. */
  MAX_MATRIX_ELEMENTS: 100,

  /** How many verified destinations we actually pull places for. Each costs 5 Places calls. */
  SHORTLIST_DESTINATIONS: 3,

  /** Nearby Search hard-caps at 20 results per call, with no pagination. */
  PLACES_PER_CATEGORY: 20,

  /** Search radius around a *destination* — well inside the 50km API ceiling, and
   *  tight enough that results are actually about that town. */
  DESTINATION_SEARCH_RADIUS_M: 25_000,

  /** Places sent to Gemini for shortlisting. Beyond this, Flash reasoning degrades. */
  MAX_POOL_FOR_SHORTLIST: 200,

  /**
   * Finalists we fetch reviews for. Sized for a SMALL model: enough to build a
   * full day with alternates, few enough that the compose payload stays inside
   * the range where Flash-Lite reasons reliably.
   *
   * COUNT IS NOT THE LEVER HERE — composition is. Raising this makes Flash-Lite
   * worse, not better (see pack.ts). What a full day actually needs is every
   * category represented, which FINALIST_QUOTAS below guarantees.
   */
  MAX_SHORTLIST: 28,

  /** Reviews per place in the compose payload. More than this is noise, not signal. */
  MAX_REVIEWS_PER_PLACE: 2,

  /** Individual review text is truncated to this before reaching the model. */
  MAX_REVIEW_CHARS: 220,

  /** Free-text answer cap. Guards both context budget and injection surface. */
  MAX_FREETEXT_CHARS: 400,

  /** Upper bound for the haversine pre-filter: no road route beats this average. */
  MAX_PLAUSIBLE_KMH: 100,

  /** A place rated below this with enough votes to be confident is dropped mechanically. */
  MIN_RATING: 3.5,
  MIN_RATINGS_FOR_CONFIDENCE: 50,

  /** Below this many ratings we keep the place but flag it as sparse for Gemini. */
  SPARSE_DATA_THRESHOLD: 30,

  /** Weather API only forecasts 10 days out. Beyond that we degrade honestly. */
  FORECAST_HORIZON_DAYS: 10,
} as const;

/** Per-request ceilings. Exceeding any of these aborts rather than silently spending. */
export const BUDGET = {
  MAX_GEMINI_CALLS: 8, // 3 planned + up to 5 repair retries
  MAX_MAPS_CALLS: 90, // 13 geocode + 1 matrix + 3 weather + 15 core places + 4 extra places + 42 details, with headroom
  // Compose (the hardest stage) can burn through this on its own in a bad
  // case — the cap is a total across the whole pipeline, not per stage, sized
  // on the assumption that usually only one stage needs repairing.
  MAX_REPAIR_ATTEMPTS: 5, // structured-output repair loops before giving up
  /**
   * Whole-pipeline deadline. Deliberately BELOW the platform's maxDuration
   * (120s on the plan route): if these are equal, the function is killed
   * mid-stream and the browser never receives a terminal event — it just
   * hangs. The gap is the room needed to fail gracefully.
   */
  WALL_CLOCK_MS: 95_000,
  SINGLE_CALL_TIMEOUT_MS: 20_000,
  MAX_OUTPUT_TOKENS: 32_000,
} as const;

/**
 * CORE categories are searched for every candidate destination, because the
 * destination decision needs a comparable picture of each.
 */
export const CORE_CATEGORIES = [
  { key: "attraction", label: "attractions & landmarks", includedTypes: ["tourist_attraction", "historical_landmark", "museum", "art_gallery"] },
  { key: "nature", label: "parks & nature", includedTypes: ["park", "hiking_area", "national_park", "botanical_garden"] },
  { key: "food", label: "restaurants", includedTypes: ["restaurant"] },
  { key: "cafe", label: "cafes & bakeries", includedTypes: ["cafe", "coffee_shop", "bakery"] },
  { key: "stay", label: "hotels & stays", includedTypes: ["hotel", "resort_hotel", "guest_house"] },
] as const;

/**
 * EXTRA categories run ONLY on the destination that actually won.
 *
 * This is the cheap way to get depth: a full day needs breakfast, dessert and
 * an evening option, but fetching those for every candidate would triple the
 * Places spend to answer a question we only need answered once.
 */
export const EXTRA_CATEGORIES = [
  { key: "breakfast", label: "breakfast & brunch", includedTypes: ["breakfast_restaurant", "brunch_restaurant"] },
  { key: "dessert", label: "dessert & ice cream", includedTypes: ["dessert_shop", "ice_cream_shop"] },
  { key: "nightlife", label: "bars & evening", includedTypes: ["bar", "pub", "night_club"] },
  { key: "shopping", label: "markets & shops", includedTypes: ["market", "shopping_mall", "gift_shop"] },
] as const;

export const PLACE_CATEGORIES = [...CORE_CATEGORIES, ...EXTRA_CATEGORIES] as const;

/**
 * Target share of the finalist set per category.
 *
 * These exist because the old selection — shortlist ids first, extras appended,
 * then a slice to MAX_SHORTLIST — discarded EVERY extra-category place whenever
 * the shortlist came back full, which the prompt explicitly asks for (25-35 ids
 * against a cap of 28). Compose was then told to build a day with breakfast and
 * an evening option from a list that contained neither, and a thin day was the
 * only honest thing it could return.
 *
 * Weighted toward experiences because those are the day's backbone and the
 * balance rules require at least two per day. Unfilled quota is redistributed,
 * so a destination with no nightlife simply gets more sights instead.
 */
export const FINALIST_QUOTAS: Record<string, number> = {
  attraction: 6,
  nature: 5,
  food: 5,
  cafe: 3,
  stay: 2,
  breakfast: 2,
  dessert: 2,
  nightlife: 2,
  shopping: 2,
};

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number]["key"];

export const ALL_CATEGORY_KEYS = PLACE_CATEGORIES.map((c) => c.key);
