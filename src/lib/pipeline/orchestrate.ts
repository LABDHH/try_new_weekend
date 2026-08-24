import { Budget } from "../budget";
import { CORE_CATEGORIES, EXTRA_CATEGORIES, LIMITS } from "../config";
import { NoResultsError, toPlannerError } from "../errors";
import { haversineKm, maxPlausibleKm } from "../geo";
import { composeItinerary } from "../gemini/compose";
import { ideateDestinations } from "../gemini/ideate";
import { shortlistPlaces } from "../gemini/shortlist";
import { geocodeMany } from "../maps/geocode";
import { enrichMany, searchNearby, searchWideArea } from "../maps/places";
import { driveTimes } from "../maps/routes";
import { forecastForDates } from "../maps/weather";
import { driveBandFit, maxDriveHours, minDriveHours, tripDates, type Answers } from "../schema/answers";
import type { PlanEvent } from "../schema/events";
import type { DayWeather, Destination, EnrichedPlace, PoolPlace } from "../schema/places";
import type { Itinerary } from "../schema/itinerary";
import { applyHygiene, confidenceScore } from "./hygiene";
import { packPool, selectFinalists } from "./pack";

export type Emit = (e: PlanEvent) => void;

export type PlanResult = {
  itinerary: Itinerary;
  destination: Destination;
  debug: Record<string, unknown>;
};

/**
 * The full pipeline.
 *
 * Stages emit progress as they go, because this takes 25-45s and a silent
 * spinner that long reads as broken. Narrating the work also happens to be
 * honest — the user can see that real data is being fetched.
 */
export async function planTrip(answers: Answers, emit: Emit): Promise<PlanResult> {
  const budget = new Budget();
  const origin = { lat: answers.origin.lat, lng: answers.origin.lng };
  const dates = tripDates(answers);
  const hours = maxDriveHours(answers);

  // ---- 1. Ideate ---------------------------------------------------------
  emit({ type: "stage", stage: "ideating", message: "Thinking about where you could go..." });
  const ideation = await ideateDestinations(answers, budget);

  const candidates = ideation.destinations
    // Trust but verify: a candidate the model itself rates 1/5 and places far
    // outside the band is not worth a geocode, let alone a routing element.
    .filter((d) => d.confidence >= 2)
    .map((d) => ({
      name: d.region ? `${d.name}, ${d.region}` : d.name,
      displayName: d.name,
      region: d.region,
      pitch: d.pitch,
      offers: d.offers,
      seasonNote: d.seasonNote,
      matchesInterests: d.matchesInterests,
    }));

  // ---- 2. Verify: geocode -> distance sanity -> real drive times ----------
  emit({ type: "stage", stage: "verifying", message: "Checking which of those are actually reachable..." });

  const geocoded = await geocodeMany(candidates.map((c) => c.name), budget);

  const ceilingKm = maxPlausibleKm(hours, LIMITS.MAX_PLAUSIBLE_KMH);
  const verified: Destination[] = [];
  for (const c of candidates) {
    const g = geocoded.get(c.name);
    if (!g) continue; // A name that does not geocode is a name that does not exist.
    // Cheap pre-filter: no road route beats a straight line, so anything beyond
    // this cannot possibly fit the drive limit. Saves paid matrix elements.
    if (haversineKm(origin, g) > ceilingKm) continue;
    verified.push({
      name: c.displayName,
      region: c.region,
      pitch: c.pitch,
      offers: c.offers,
      seasonNote: c.seasonNote,
      matchesInterests: c.matchesInterests,
      lat: g.lat,
      lng: g.lng,
    });
  }

  // Fallback: if ideation came back thin, sweep a wide rectangle. Text Search's
  // locationRestriction takes a rectangle and has no 50km cap, unlike Nearby
  // Search's circle — this is the only way to cover a multi-hundred-km catchment.
  if (verified.length < 2) {
    emit({ type: "stage", stage: "verifying", message: "Widening the search..." });
    const wide = await searchWideArea(
      origin,
      ceilingKm,
      "popular weekend getaway towns and tourist attractions",
      budget,
    );
    const seen = new Set(verified.map((v) => v.name.toLowerCase()));
    for (const p of wide.slice(0, 10)) {
      if (seen.has(p.name.toLowerCase())) continue;
      if (haversineKm(origin, p) > ceilingKm) continue;
      seen.add(p.name.toLowerCase());
      verified.push({ name: p.name, lat: p.lat, lng: p.lng, pitch: "Found nearby" });
    }
  }

  if (verified.length === 0) {
    throw new NoResultsError(
      `We couldn't find anywhere worth driving to within ${hours} hours of ${answers.origin.name}. Try widening your drive time.`,
    );
  }

  const legs = await driveTimes(origin, verified, new Date(answers.departAt), budget);
  const legByIndex = new Map(legs.map((l) => [l.destinationIndex, l]));

  // Attach real, traffic-aware drive times. No route == drops out entirely.
  const routed: Destination[] = [];
  verified.forEach((d, i) => {
    const leg = legByIndex.get(i);
    if (!leg) return;
    routed.push({ ...d, driveSeconds: leg.seconds, driveMeters: leg.meters });
  });
  // Rank by how well each drive time matches the REQUESTED BAND, not by which
  // is nearest. Sorting ascending was why picking "3-5 hrs" returned 90-minute
  // destinations: the nearest-first sort silently overrode the stated intent.
  routed.sort((a, b) => driveBandFit(answers, b.driveSeconds ?? 0) - driveBandFit(answers, a.driveSeconds ?? 0));

  let reachable = routed.filter((d) => (d.driveSeconds ?? 0) <= hours * 3600);

  // Prefer destinations that actually land inside the band. Fall back to the
  // merely-reachable ones only when the band cannot be filled.
  const inBand = reachable.filter((d) => driveBandFit(answers, d.driveSeconds ?? 0) === 1);
  let undershot = false;
  if (inBand.length >= 2) {
    reachable = [...inBand, ...reachable.filter((d) => !inBand.includes(d))];
  } else if (inBand.length === 0 && reachable.length > 0) {
    // Nothing in range — the itinerary should say so rather than pretend.
    undershot = true;
  }

  // Never return an empty state. If nothing fits the stated cap, offer the
  // closest option with an honest caveat rather than a dead end.
  let stretched = false;
  if (reachable.length === 0) {
    if (routed.length === 0) {
      throw new NoResultsError(
        `We couldn't find a drivable route to anywhere within range of ${answers.origin.name}.`,
      );
    }
    reachable = routed.slice(0, 1);
    stretched = true;
  }

  const shortlisted = reachable.slice(0, LIMITS.SHORTLIST_DESTINATIONS);
  emit({ type: "destinations", names: shortlisted.map((d) => d.name) });

  // ---- 3. Weather --------------------------------------------------------
  emit({ type: "stage", stage: "weather", message: `Checking the forecast for ${shortlisted[0].name}...` });
  const weatherByDest = new Map<string, DayWeather[]>();
  await Promise.all(
    shortlisted.map(async (d) => {
      weatherByDest.set(d.name, await forecastForDates(d, dates, budget));
    }),
  );

  // ---- 4. Place pool (search centred on each DESTINATION, not the origin) --
  emit({ type: "stage", stage: "places", message: "Finding places worth your time..." });
  // CORE categories only at this stage: the destination decision needs a
  // comparable picture of each candidate, not an exhaustive one.
  //
  // Every destination x category pair fires at once. Iterating destinations
  // sequentially meant three round-trips where one would do — barely visible
  // locally, but painful from a function region far from the API.
  const searches = shortlisted.flatMap((dest) =>
    CORE_CATEGORIES.map((c) => searchNearby(dest, c.key, budget).catch(() => [])),
  );
  const rawPool: PoolPlace[] = (await Promise.all(searches)).flat();

  const { kept, dropped } = applyHygiene(rawPool);
  if (kept.length < 5) {
    throw new NoResultsError(
      `We found somewhere to go, but not enough open places nearby to build a real plan. Try a different drive-time range.`,
    );
  }
  const packed = packPool(kept);

  // ---- 5. Shortlist ------------------------------------------------------
  emit({ type: "stage", stage: "shortlisting", message: "Narrowing down to the best fits..." });
  const shortlist = await shortlistPlaces(answers, shortlisted, packed, weatherByDest, budget);

  const chosen =
    shortlisted.find((d) => d.name.toLowerCase() === shortlist.destinationName.toLowerCase()) ??
    shortlisted[0];

  emit({
    type: "chosen",
    name: chosen.name,
    driveMinutes: Math.round((chosen.driveSeconds ?? 0) / 60),
  });

  // ---- 6. Deepen the pool for the winner, then enrich ------------------
  //
  // Now that one destination has won, it is worth buying breakfast/dessert/
  // evening/market coverage for it. Doing this for every candidate would have
  // tripled the Places spend to answer a question we only needed once.
  emit({ type: "stage", stage: "places", message: `Digging deeper into ${chosen.name}...` });

  const extraResults = await Promise.all(
    EXTRA_CATEGORIES.map((c) => searchNearby(chosen, c.key, budget).catch(() => [])),
  );
  const extraRaw = extraResults.flat();
  const { kept: extraKept } = applyHygiene(extraRaw);

  // Top few per extra category — enough to give the day breakfast and an
  // evening option without flooding the enrichment budget.
  const extrasByCategory = new Map<string, PoolPlace[]>();
  for (const p of extraKept) {
    const list = extrasByCategory.get(p.category) ?? [];
    list.push(p);
    extrasByCategory.set(p.category, list);
  }
  const extras: PoolPlace[] = [];
  for (const list of extrasByCategory.values()) {
    list.sort((a, b) => confidenceScore(b) - confidenceScore(a));
    extras.push(...list.slice(0, 3));
  }

  emit({ type: "stage", stage: "enriching", message: "Reading reviews for the shortlist..." });

  const byId = new Map(packed.map((p) => [p.id, p]));
  for (const e of extras) if (!byId.has(e.id)) byId.set(e.id, e);

  const shortlistIds = shortlist.placeIds.filter((id) => byId.has(id));
  const extraIds = extras.map((e) => e.id).filter((id) => !shortlistIds.includes(id));
  // Category-balanced, NOT a plain slice. The shortlist is requested as 25-35
  // ids against a cap of 28, so appending extras and slicing dropped all of
  // them — every breakfast, dessert and evening place — exactly whenever the
  // model did what it was asked. See selectFinalists.
  const finalistIds = selectFinalists([...shortlistIds, ...extraIds], byId, LIMITS.MAX_SHORTLIST);

  const enrichment = await enrichMany(finalistIds, budget);

  const enriched: EnrichedPlace[] = finalistIds.map((id) => {
    const base = byId.get(id)!;
    const extra = enrichment.get(id);
    return { ...base, ...(extra ? { ...extra, id: base.id } : {}) };
  });

  // ---- 7. Compose --------------------------------------------------------
  emit({ type: "stage", stage: "composing", message: `Building your ${dates.length === 1 ? "day" : "weekend"} in ${chosen.name}...` });
  const itinerary = await composeItinerary(
    answers,
    chosen,
    enriched,
    weatherByDest.get(chosen.name) ?? [],
    shortlist.whyThisDestination,
    budget,
  );

  if (stretched) {
    itinerary.caveats = [
      `Nothing fit inside your ${hours}-hour drive limit, so this is the closest option at about ${Math.round((chosen.driveSeconds ?? 0) / 60)} minutes.`,
      ...itinerary.caveats,
    ].slice(0, 5);
  }

  if (undershot) {
    const actual = ((chosen.driveSeconds ?? 0) / 3600).toFixed(1);
    itinerary.caveats = [
      `You asked for ${minDriveHours(answers)}-${hours} hours of driving; nothing in that range worked out, so this one is about ${actual} hours away.`,
      ...itinerary.caveats,
    ].slice(0, 6);
  }

  const missingForecast = (weatherByDest.get(chosen.name) ?? []).filter((w) => !w.available);
  if (missingForecast.length > 0) {
    itinerary.caveats = [
      ...itinerary.caveats,
      `Your trip is more than 10 days out, so there's no forecast yet — check the weather closer to the date.`,
    ].slice(0, 5);
  }

  return {
    itinerary,
    destination: chosen,
    debug: {
      budget: budget.snapshot(),
      poolSize: rawPool.length,
      afterHygiene: kept.length,
      packed: packed.length,
      dropped,
      finalists: finalistIds.length,
      extraPlaces: extras.length,
      candidatesProposed: ideation.destinations.length,
      candidatesVerified: verified.length,
      candidatesReachable: reachable.length,
      stretched,
      undershot,
      driveBand: `${minDriveHours(answers)}-${hours}h`,
      chosenDriveHours: Number((((chosen.driveSeconds ?? 0) / 3600)).toFixed(2)),
    },
  };
}

export { toPlannerError };
