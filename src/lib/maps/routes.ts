import type { Budget } from "../budget";
import { LIMITS, env } from "../config";
import { fetchJson } from "../http";
import type { LatLng } from "../geo";

type MatrixElement = {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  distanceMeters?: number;
  condition?: string;
  status?: { code?: number; message?: string };
};

export type DriveLeg = {
  destinationIndex: number;
  seconds: number;
  meters: number;
};

const waypoint = (p: LatLng) => ({
  waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
});

/** Durations come back as protobuf strings like "5432s". */
function parseSeconds(d?: string): number | null {
  if (!d) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(d);
  return m ? Number(m[1]) : null;
}

/**
 * Traffic-aware drive times from one origin to many destinations, in a single
 * billed call.
 *
 * `TRAFFIC_AWARE_OPTIMAL` caps the matrix at 100 elements; with one origin that
 * is 100 destinations, and we send ~12. `departureTime` is the user's real
 * stated leaving time, which is the whole point — a Saturday 7am departure and
 * a Friday 6pm departure are very different drives.
 */
export async function driveTimes(
  origin: LatLng,
  destinations: LatLng[],
  departureTime: Date,
  budget: Budget,
): Promise<DriveLeg[]> {
  if (destinations.length === 0) return [];

  const capped = destinations.slice(0, LIMITS.MAX_MATRIX_ELEMENTS);

  // The API rejects a departureTime in the past for DRIVE mode. Submit latency
  // or a slightly stale form can push a valid choice just over the line, so we
  // nudge to now+60s rather than failing the whole request.
  const safeDeparture =
    departureTime.getTime() <= Date.now() ? new Date(Date.now() + 60_000) : departureTime;

  const data = await fetchJson<MatrixElement[]>({
    api: "Routes:computeRouteMatrix",
    url: "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    method: "POST",
    headers: {
      "X-Goog-Api-Key": env().GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask":
        "originIndex,destinationIndex,duration,distanceMeters,status,condition",
    },
    body: {
      origins: [waypoint(origin)],
      destinations: capped.map(waypoint),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      departureTime: safeDeparture.toISOString(),
    },
    budget,
    sku: "routes:matrix:pro",
  });

  const legs: DriveLeg[] = [];
  for (const el of data ?? []) {
    // A non-zero status code means no route exists (island, no road link).
    // Those destinations simply drop out rather than defaulting to some number.
    if (el.status?.code) continue;
    if (el.condition && el.condition !== "ROUTE_EXISTS") continue;

    const seconds = parseSeconds(el.duration);
    if (seconds === null || el.destinationIndex === undefined) continue;

    legs.push({
      destinationIndex: el.destinationIndex,
      seconds,
      meters: el.distanceMeters ?? 0,
    });
  }

  return legs;
}
