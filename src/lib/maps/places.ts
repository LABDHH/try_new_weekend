import type { Budget } from "../budget";
import { LIMITS, PLACE_CATEGORIES, env, type PlaceCategory } from "../config";
import { fetchJson } from "../http";
import { boundingBox, type LatLng } from "../geo";
import type { PlaceEnrichment, PoolPlace } from "../schema/places";

const BASE = "https://places.googleapis.com/v1";

/**
 * Broad-pool field mask. Billed at the Nearby Search **Enterprise** SKU because
 * of rating/userRatingCount/priceLevel/openingHours.
 *
 * The point: this returns quality signal for up to 20 places in ONE billed
 * call. Fetching the same data via per-place Place Details would be ~20x the
 * cost for identical information.
 */
const POOL_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.googleMapsUri",
  "places.websiteUri",
].join(",");

/** Enterprise + Atmosphere — the expensive SKU. Only ever used on finalists. */
const ENRICH_MASK = [
  "id",
  "displayName",
  "reviewSummary",
  "editorialSummary",
  "reviews",
].join(",");

type RawPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  googleMapsUri?: string;
  websiteUri?: string;
};

function mapPlace(p: RawPlace, category: PlaceCategory): PoolPlace | null {
  if (!p.id || !p.location) return null;
  // Mechanical hygiene, not taste: a closed business cannot be visited.
  if (p.businessStatus && p.businessStatus !== "OPERATIONAL") return null;

  return {
    id: p.id,
    name: p.displayName?.text ?? "Unnamed place",
    address: p.formattedAddress,
    lat: p.location.latitude,
    lng: p.location.longitude,
    category,
    primaryType: p.primaryType,
    types: p.types ?? [],
    rating: p.rating,
    ratingCount: p.userRatingCount,
    priceLevel: p.priceLevel,
    openingHours: p.regularOpeningHours?.weekdayDescriptions ?? [],
    mapsUri: p.googleMapsUri,
    websiteUri: p.websiteUri,
    sparseData: false,
  };
}

/**
 * Nearby Search centred on a DESTINATION, not on the user's origin.
 *
 * This is what makes the API's hard 50km radius ceiling a non-issue: by the
 * time we search, the centre has already moved to the candidate town, so a
 * 25km radius covers it comfortably.
 */
export async function searchNearby(
  center: LatLng,
  category: PlaceCategory,
  budget: Budget,
): Promise<PoolPlace[]> {
  const cat = PLACE_CATEGORIES.find((c) => c.key === category);
  if (!cat) return [];

  const data = await fetchJson<{ places?: RawPlace[] }>({
    api: "Places:searchNearby",
    url: `${BASE}/places:searchNearby`,
    method: "POST",
    headers: {
      "X-Goog-Api-Key": env().GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": POOL_MASK,
    },
    body: {
      includedTypes: [...cat.includedTypes],
      maxResultCount: LIMITS.PLACES_PER_CATEGORY,
      rankPreference: "POPULARITY",
      locationRestriction: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: LIMITS.DESTINATION_SEARCH_RADIUS_M,
        },
      },
    },
    budget,
    sku: "places:nearby:enterprise",
  });

  return (data.places ?? [])
    .map((p) => mapPlace(p, category))
    .filter((p): p is PoolPlace => p !== null);
}

/**
 * Wide-area fallback for destination discovery.
 *
 * Text Search `locationRestriction` takes a RECTANGLE, which — unlike Nearby
 * Search's circle — has no 50km cap. That is the only way to sweep a 300km
 * catchment in one query. Used only when Gemini's ideation comes back thin.
 */
export async function searchWideArea(
  center: LatLng,
  radiusKm: number,
  query: string,
  budget: Budget,
): Promise<PoolPlace[]> {
  const data = await fetchJson<{ places?: RawPlace[] }>({
    api: "Places:searchText",
    url: `${BASE}/places:searchText`,
    method: "POST",
    headers: {
      "X-Goog-Api-Key": env().GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": POOL_MASK,
    },
    body: {
      textQuery: query,
      pageSize: 20,
      locationRestriction: { rectangle: boundingBox(center, radiusKm) },
    },
    budget,
    sku: "places:text:enterprise",
  });

  return (data.places ?? [])
    .map((p) => mapPlace(p, "attraction"))
    .filter((p): p is PoolPlace => p !== null);
}

type RawDetails = {
  id?: string;
  reviewSummary?: { text?: { text?: string }; reviewsUri?: string };
  editorialSummary?: { text?: string };
  reviews?: Array<{ text?: { text?: string }; rating?: number }>;
};

/**
 * Place Details at Enterprise + Atmosphere — reviews and Google's own review
 * synthesis. Deliberately called only for shortlisted finalists: ~24 places
 * instead of ~300, which is both far cheaper and a much cleaner context for
 * the composing model.
 */
export async function enrichPlace(
  placeId: string,
  budget: Budget,
): Promise<PlaceEnrichment> {
  const data = await fetchJson<RawDetails>({
    api: "Places:details",
    url: `${BASE}/places/${encodeURIComponent(placeId)}`,
    headers: {
      "X-Goog-Api-Key": env().GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": ENRICH_MASK,
    },
    budget,
    sku: "places:details:enterprise_atmosphere",
  });

  const reviews = (data.reviews ?? [])
    .map((r) => r.text?.text?.trim())
    .filter((t): t is string => Boolean(t))
    .slice(0, LIMITS.MAX_REVIEWS_PER_PLACE)
    .map((t) =>
      t.length > LIMITS.MAX_REVIEW_CHARS ? `${t.slice(0, LIMITS.MAX_REVIEW_CHARS)}...` : t,
    );

  return {
    id: placeId,
    reviewSummary: data.reviewSummary?.text?.text,
    // Required for attribution if the summary text is displayed.
    reviewSummaryUri: data.reviewSummary?.reviewsUri,
    editorialSummary: data.editorialSummary?.text,
    reviews,
  };
}

/** Enriches finalists concurrently; a failure on one place must not sink the trip. */
export async function enrichMany(
  placeIds: string[],
  budget: Budget,
): Promise<Map<string, PlaceEnrichment>> {
  const out = new Map<string, PlaceEnrichment>();
  const settled = await Promise.allSettled(
    placeIds.map((id) => enrichPlace(id, budget)),
  );
  for (const s of settled) {
    if (s.status === "fulfilled") out.set(s.value.id, s.value);
  }
  return out;
}
