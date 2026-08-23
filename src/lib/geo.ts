export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. Used as a cheap pre-filter before paid routing calls. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Bounding box for a radius around a point.
 * Text Search `locationRestriction` takes a rectangle and — unlike Nearby
 * Search's circle — has no 50km ceiling, which is what makes the wide-area
 * destination fallback possible at all.
 */
export function boundingBox(center: LatLng, radiusKm: number) {
  const latDelta = radiusKm / 111.32;
  // Longitude degrees shrink toward the poles; guard against cos → 0.
  const cosLat = Math.max(0.01, Math.cos(toRad(center.lat)));
  const lngDelta = radiusKm / (111.32 * cosLat);

  return {
    low: {
      latitude: clampLat(center.lat - latDelta),
      longitude: wrapLng(center.lng - lngDelta),
    },
    high: {
      latitude: clampLat(center.lat + latDelta),
      longitude: wrapLng(center.lng + lngDelta),
    },
  };
}

const clampLat = (v: number) => Math.max(-90, Math.min(90, v));
const wrapLng = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;

/** Straight-line ceiling for a drive time. Roads are never faster than this average. */
export function maxPlausibleKm(hours: number, maxKmh: number): number {
  return hours * maxKmh;
}

export function isValidLatLng(p: unknown): p is LatLng {
  if (typeof p !== "object" || p === null) return false;
  const { lat, lng } = p as Record<string, unknown>;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
