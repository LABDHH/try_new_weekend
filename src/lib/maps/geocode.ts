import type { Budget } from "../budget";
import { env } from "../config";
import { NoResultsError } from "../errors";
import { fetchJson } from "../http";
import type { LatLng } from "../geo";

type GeocodeResponse = {
  status: string;
  error_message?: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
};

export type GeocodeResult = LatLng & { formattedAddress: string };

/**
 * Geocoding API (Essentials SKU).
 *
 * Doubles as the reality check on Gemini's proposed destinations: a name that
 * does not geocode is a name that does not exist, and it dies here.
 */
export async function geocode(
  query: string,
  budget: Budget,
): Promise<GeocodeResult | null> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(query)}` +
    `&key=${env().GOOGLE_MAPS_API_KEY}`;

  const data = await fetchJson<GeocodeResponse>({
    api: "Geocoding",
    url,
    budget,
    sku: "geocoding",
  });

  // Status is checked FIRST. A failed request also returns an empty results
  // array, so testing for emptiness first would report a bad key, a disabled
  // API, or a blown quota as "no such place" — a silent, misleading failure.
  if (data.status === "ZERO_RESULTS") return null;

  if (data.status !== "OK") {
    throw new NoResultsError(
      `Geocoding failed: ${data.status}${data.error_message ? ` — ${data.error_message}` : ""}. ` +
        `Common causes: the Geocoding API isn't enabled on the Cloud project, no billing account is attached, ` +
        `or the key is restricted by HTTP referrer (server-side calls need API restrictions instead).`,
    );
  }

  if (data.results.length === 0) return null;

  const top = data.results[0];
  return {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    formattedAddress: top.formatted_address,
  };
}

/** Resolves many destination names concurrently, dropping the ones that fail. */
export async function geocodeMany(
  names: string[],
  budget: Budget,
): Promise<Map<string, GeocodeResult>> {
  const out = new Map<string, GeocodeResult>();
  const settled = await Promise.allSettled(
    names.map(async (n) => ({ name: n, result: await geocode(n, budget) })),
  );
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value.result) {
      out.set(s.value.name, s.value.result);
    }
  }
  return out;
}
