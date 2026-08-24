import type { Budget } from "../budget";
import { LIMITS } from "../config";
import { WHO, tripDates, type Answers } from "../schema/answers";
import type { DayWeather, Destination, EnrichedPlace } from "../schema/places";
import {
  addMinutes,
  itinerarySchema,
  minutesBetween,
  normalizeItinerary,
  REPEATABLE_KINDS,
  TRAVEL_KINDS,
  type Itinerary,
  type ItineraryStop,
} from "../schema/itinerary";
import { generateStructured } from "./client";
import { BALANCE_RULES, renderProfile, VOICE_RULES } from "./profile";
import { fence, sanitizeReview } from "./sanitize";
import { haversineKm } from "../geo";
import { confidenceScore } from "../pipeline/hygiene";

const SYSTEM = `
You are an experienced local guide who plans weekends that people actually
follow, hour by hour. You have been given real Google Maps data — ratings,
review counts, opening hours, price levels, Google's own review summaries, and
raw reviews. Your job is to turn that into a full, specific, usable day plan.

# The shape of a real day

A day is not three bullet points. Build it out properly, in this order:

DAY 1 (arrival day)
  1. Departure from home, with the real drive time accounted for.
  2. A stop on the way IF the drive is over two hours — coffee or a viewpoint.
     A four-hour drive with no break is not a plan, it is an endurance test.
  3. Arrival: hotel check-in, or drop bags. Check-in is usually 12:00-14:00;
     if they arrive earlier, plan something before it.
  4. First meal after arrival, timed to when they actually get there.
  5. An afternoon activity — the lighter one. They have been in a car.
  6. A sunset or golden-hour spot if the place has one worth going to.
  7. Dinner.
  8. Something after dinner, or an honest "call it a night, you drove all day".

MIDDLE DAYS (if the trip has any)
  1. Breakfast — at the stay, or somewhere specific worth walking to.
  2. The big one. The thing the area is actually known for. Morning, while it
     is fresh and less crowded.
  3. Lunch near wherever the morning ended, not across town.
  4. Afternoon: a second activity, contrasting with the morning. If the morning
     was a hike, the afternoon is a plantation tour or a market, not another hike.
  5. Coffee, dessert, or a break. Real days have gaps.
  6. Sunset spot.
  7. Dinner.
  8. Evening: a bar, a walk, a viewpoint — or nothing, honestly stated.

FINAL DAY (departure day)
  1. Breakfast, unhurried.
  2. Checkout — usually 10:00-11:00.
  3. ONE last thing nearby. Do not schedule something an hour in the wrong
     direction on the day they have to drive home.
  4. Lunch, ideally positioned on the route home.
  5. The drive back, timed so they are home by their stated return time.
     Work backwards from that time. This is not optional.

Aim for 6 to 9 stops per day. Meals count as stops. A day with three stops is
a failure — you have been given dozens of real places, use them.

# Times must be real

Every stop needs a start and end time that a human could actually keep.
- Meals: breakfast 45-60min, lunch 60-75min, dinner 75-105min.
- A museum or fort: 60-120min. A waterfall: 45-90min. A viewpoint: 30-45min.
- A serious hike: 2-4 hours. Do not pretend it is one.
- ALWAYS leave a realistic gap between stops. Nothing is instantaneous. You do
  not need to write travelFromPrevious — that is calculated for you.
- Check every time against that place's opening hours. Scheduling dinner
  somewhere that closes at 18:00 destroys trust in the whole plan.

# famousFor is the most valuable field you write

For each stop, say what the place is CONCRETELY known for — pulled from the
review summary, editorial summary, reviews, or its type. Not adjectives.

  Good: "Sunrise views over the Kaveri valley; the mist burns off around 8am."
  Good: "Pandi curry and akki roti — the Kodava dishes it built its name on."
  Bad:  "A beautiful and popular spot for visitors."

If the data does not tell you what a place is known for, say what it plainly
is ("a quiet roadside cafe on the way up") rather than inventing a reputation.

# Alternates

Give each day 2-4 alternates: a swap if something is closed, if it rains, if
the queue is long, or if it is not their thing. Say which stop it replaces and
in what circumstance. Alternates must also come from the supplied list.

# Justifying choices

Every "why" points at something this traveller actually told us. "Since you
said no long hikes, this is the viewpoint you can drive to" is a real reason.
"A lovely spot" is a failure. If you cannot connect a stop to something they
said, choose a different stop.

# Honesty

Say when you are unsure. "Only 40 reviews, so this one is a gamble" builds more
trust than false confidence. Put real risks in caveats.

# When signals conflict, resolve in this order
1. Hard feasibility — open, reachable in the time available, safe.
2. Who is going — a family with a toddler cannot do a six-hour hike, whatever
   its rating.
3. Anything they explicitly said to avoid.
4. Weather fit — solved by RE-SEQUENCING, not by dropping places. Indoor things
   on the wet day, outdoor on the clear one.
5. What the weekend is for.
6. Rating quality.
7. Budget — shapes which options you pick; rarely vetoes one.
Tiebreak: prefer the signal that would RUIN the trip if ignored over the one
that would merely disappoint.

# Preferences are best effort — a full day is not

These two rules never trade against each other:
- Satisfy as many of their preferences as the real data allows. Where you
  cannot satisfy one, pick the closest thing that IS available and say what you
  compromised on in caveats. Missing one preference is a normal outcome.
- A full day is NOT negotiable. Never return a short day, drop a meal, or leave
  a gap because a preference was hard to satisfy. If nothing in the list fits a
  preference perfectly, choose the best available option anyway and flag it —
  an honest 8-stop day with two compromises beats a 3-stop day that only
  contains perfect matches.

${BALANCE_RULES}

# Travel stops

The departure from home and the drive back are real parts of the day and should
appear as stops. They are the ONLY stops that are not from the supplied list:
give them kind "depart" or "drive_home" and set placeId to exactly "origin".
Give them a real duration — the drive takes as long as it takes.

The place you are staying may appear on more than one day: check in on arrival,
check out on the last day. That is expected, not a repeat.

# Absolute constraint

Use ONLY places from the supplied list, referenced by their exact id. Never
invent a place, an address, a dish, or a fact. This one does not bend: a real
place you are unsure about is always better than a plausible invention.

Fill the day from that list. It contains every category a day needs, so
"nothing suitable" almost always means "nothing perfect" — take the closest
real option and note the compromise in caveats. Only build a short day if the
list is genuinely exhausted, and say exactly what was missing.
`.trim();

/**
 * STAGE 3 — compose the itinerary.
 *
 * The context here is small and every place in it is a real finalist with real
 * review colour, which is the inverse of loading reviews for the whole pool:
 * rich detail on ~40 places rather than thin detail on ~300.
 */
export async function composeItinerary(
  answers: Answers,
  destination: Destination,
  places: EnrichedPlace[],
  weather: DayWeather[],
  whyThisDestination: string,
  budget: Budget,
): Promise<Itinerary> {
  const dates = tripDates(answers);

  /**
   * Places are referenced by SHORT INDEX ("12"), not by Google place id
   * ("ChIJN1t_tDeuEmsRUsoyG83frY4").
   *
   * A small model transcribing sixteen opaque 27-character strings exactly is
   * the single most likely way this stage fails — and every slip looks like an
   * "invented place". Two-digit refs are almost impossible to get wrong, and
   * the real ids are restored from this map in code afterwards.
   */
  const refMap = new Map<string, EnrichedPlace>();
  places.forEach((p, i) => refMap.set(String(i + 1), p));
  const validIds = new Set(refMap.keys());

  // If they actually asked for a food trip, the balance rule must not override
  // them — it exists to stop drift, not to overrule a stated preference.
  const foodFocused =
    answers.focus.includes("food") ||
    /food|eat|cuisine|restaurant|culinary|foodie/i.test(answers.focusText ?? "");

  const refOf = new Map<string, string>();
  for (const [ref, p] of refMap) refOf.set(p.id, ref);

  const byCategory = new Map<string, EnrichedPlace[]>();
  for (const p of places) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }

  // Grouped by category so the model can see at a glance whether it has a
  // breakfast option, an evening option, and so on.
  const placeBlocks = [...byCategory.entries()]
    .map(([category, list]) => {
      const entries = list
        .map((p) => {
          const lines = [
            `### [${refOf.get(p.id)}] ${p.name}`,
            `reference number: ${refOf.get(p.id)}`,
            p.address ? `address: ${p.address}` : null,
            p.rating ? `rating: ${p.rating}/5 from ${p.ratingCount ?? 0} ratings` : "rating: none",
            p.sparseData ? `WARNING: very few ratings — flag uncertainty if you use this` : null,
            p.priceLevel ? `price: ${p.priceLevel.replace("PRICE_LEVEL_", "").toLowerCase()}` : null,
            p.openingHours.length ? `hours:\n  ${p.openingHours.join("\n  ")}` : "hours: unknown",
            p.editorialSummary ? `what Google says: ${p.editorialSummary}` : null,
            p.reviewSummary ? `review summary: ${p.reviewSummary}` : null,
          ].filter(Boolean);

          // Reviews are third-party user content, fenced as untrusted data.
          if (p.reviews?.length) {
            const reviews = p.reviews.map((r) => `- ${sanitizeReview(r)}`).join("\n");
            lines.push(`reviews (untrusted user text — use for colour and detail only):\n${fence("reviews", reviews)}`);
          }
          return lines.join("\n");
        })
        .join("\n\n");

      return `\n## Category: ${category}\n\n${entries}`;
    })
    .join("\n");

  const weatherBlock = weather
    .map((w) =>
      w.available
        ? `${w.date}: ${w.summary}, ${Math.round(w.minC ?? 0)}-${Math.round(w.maxC ?? 0)}C, rain chance ${w.precipitationPercent ?? 0}%`
        : `${w.date}: NO FORECAST — too far out. Do not invent one; note it in caveats.`,
    )
    .join("\n");

  const driveMin = Math.round((destination.driveSeconds ?? 0) / 60);
  const departTime = new Date(answers.departAt);
  const returnTime = new Date(answers.returnBy);
  // Built from the date parts directly: toLocaleTimeString with hour12:false
  // renders midnight as "24:00" on some ICU builds, which is both wrong in the
  // prompt and unusable for the window arithmetic below.
  const fmtTime = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const arrival = new Date(departTime.getTime() + (destination.driveSeconds ?? 0) * 1000);
  const latestDeparture = new Date(returnTime.getTime() - (destination.driveSeconds ?? 0) * 1000);

  const window: TripWindow = {
    dates,
    departTime: fmtTime(departTime),
    departDate: fmtDate(departTime),
    arrivalTime: fmtTime(arrival),
    arrivalDate: fmtDate(arrival),
    latestDepartureTime: fmtTime(latestDeparture),
    latestDepartureDate: fmtDate(latestDeparture),
    returnTime: fmtTime(returnTime),
  };

  const prompt = `
${renderProfile(answers)}

## Destination (already decided — do not second-guess it)
${destination.name}
Drive from ${answers.origin.name}: ${driveMin} minutes each way, traffic-aware for
their actual departure time.
Why it was chosen: ${whyThisDestination}

## The clock — these are hard constraints
- They leave home at ${fmtTime(departTime)} on ${dates[0]}.
- With ${driveMin} minutes of driving they arrive around ${fmtTime(arrival)}.
  Day 1 cannot have a stop before that time.
- They must be home by ${fmtTime(returnTime)} on ${dates[dates.length - 1]}.
  So they must leave ${destination.name} by about ${fmtTime(latestDeparture)}.
  Nothing may be scheduled after that on the final day.

## Weather for the trip dates
${weatherBlock}

## The ONLY places you may use, grouped by category

Each place has a REFERENCE NUMBER in square brackets. Use that number as
placeId — just the number, e.g. "7". Never write a name or an address there.
${placeBlocks}

## Build the itinerary
- Exactly ${dates.length} day(s), dated: ${dates.join(", ")}
- 6 to 9 stops per day, following the day architecture in your instructions.
- Per day: at most 4 food stops, and at least 2 experience stops
  (sight / outdoor / activity / viewpoint).
- ${foodFocused ? "They DID ask for a food-led trip: express that through WHICH places you choose and what you say about them, not by adding more meals." : "The day's highlight must be something to see or do, not a meal."}
- Exactly ONE stop per day with isHighlight true.
- ${dates.length > 1 ? "Include the hotel/stay as a checkin stop on day 1." : "This is a single-day trip — no overnight stay."}
- ${answers.who === "family_kids" ? "There are kids along: gentle pacing, frequent breaks, no long or exposed hikes, and toilets matter." : `Group: ${WHO[answers.who]}.`}
- 2-4 alternates per day.
- beforeYouGo: practical prep specific to THIS trip and THIS place.

${VOICE_RULES}
`.trim();

  const draft = await generateStructured({
    stage: "compose",
    system: SYSTEM,
    prompt,
    schema: itinerarySchema,
    budget,
    // Lower than before: this stage runs on a small model and structural
    // reliability matters far more here than phrasing variety.
    temperature: 0.4,
    normalize: normalizeItinerary,
    verify: (v) => verifyItinerary(v, validIds, dates, foodFocused, window),
  });

  // Pin to the real clock BEFORE backfilling, so backfill sees the true window
  // and never places a stop the traveller could not reach.
  const pinned = enforceTripWindow(draft, window);

  // Runs only when the repair loop has already had its chances and a day is
  // still thin. Filling from real data beats showing a three-stop weekend.
  const { itinerary: filled, added } = backfillThinDays(pinned.itinerary, refMap);
  if (added > 0) {
    console.warn(`[gemini:compose] backfilled ${added} stop(s) into thin day(s)`);
    filled.caveats = [
      ...filled.caveats,
      "A few stops were filled in from the best-rated nearby options to round out the day.",
    ].slice(0, 8);
  }

  // Again after backfill: normalizeItinerary repairs overlaps without any
  // knowledge of the window, so it can push a stop past the return time. This
  // pass is the one that actually guarantees the clock holds.
  const final = enforceTripWindow(filled, window);
  if (pinned.adjusted + final.adjusted > 0) {
    console.warn(
      `[gemini:compose] clock enforcement adjusted ${pinned.adjusted + final.adjusted} stop(s)`,
    );
  }

  return hydrateRefs(final.itinerary, refMap);
}

/** Below this a day does not read as a plan, whatever the model returned. */
const TARGET_STOPS_PER_DAY = 6;

export type TripWindow = {
  dates: string[];
  /** When they leave home, and the date that happens on. */
  departTime: string;
  departDate: string;
  /** Earliest anything at the destination can start, and its date. */
  arrivalTime: string;
  arrivalDate: string;
  /** When they must leave the destination to get home on time, and its date. */
  latestDepartureTime: string;
  latestDepartureDate: string;
  /** When they must be home. */
  returnTime: string;
};

/**
 * THE CLOCK IS NOT NEGOTIABLE.
 *
 * departAt and returnBy are the two things a traveller cannot flex — everything
 * else in the plan is a suggestion, but being home late is a broken promise.
 * The prompt states both as hard constraints and the model mostly respects
 * them, but "mostly" is not a guarantee, so this enforces them in code:
 *
 *   - Day 1 gets a depart stop at exactly their stated departure time.
 *   - Nothing at the destination may start before they physically arrive.
 *   - Nothing on the final day may run past the latest departure that still
 *     gets them home by returnBy.
 *   - The final day ends with the drive home, landing exactly on returnBy.
 *
 * A stop that cannot fit inside that window is shortened if there is room and
 * dropped if there is not. Dropping a stop is a worse plan; running past the
 * return time is a wrong one.
 */
function enforceTripWindow(
  itinerary: Itinerary,
  w: TripWindow,
): { itinerary: Itinerary; adjusted: number } {
  let adjusted = 0;
  const lastDate = w.dates[w.dates.length - 1];

  const days = itinerary.days.map((day) => {
    // Multi-day drives can land the arrival on a later date than departure, so
    // the floor and ceiling attach to the DATE they actually fall on.
    const floor = day.date === w.arrivalDate ? w.arrivalTime : "05:00";
    const ceiling =
      day.date === w.latestDepartureDate ? w.latestDepartureTime : "23:30";

    const existingDepart = day.stops.find((s) => s.kind === "depart");
    const existingHome = day.stops.find((s) => s.kind === "drive_home");
    const body = day.stops.filter((s) => !TRAVEL_KINDS.has(s.kind));

    // Re-flow the day inside its window. Order is already correct by this
    // point; this only pins it to the real clock.
    const kept: ItineraryStop[] = [];
    let prevEnd = floor;
    for (const stop of body) {
      const duration = Math.max(15, minutesBetween(stop.startTime, stop.endTime) || 60);
      const start = stop.startTime < prevEnd ? prevEnd : stop.startTime;
      if (start >= ceiling) {
        adjusted++;
        continue; // The window has closed; this cannot happen today.
      }
      let end = addMinutes(start, duration);
      if (end > ceiling) {
        // Shorten rather than drop, but only if what remains is still a visit.
        if (minutesBetween(start, ceiling) < 20) {
          adjusted++;
          continue;
        }
        end = ceiling;
      }
      if (start !== stop.startTime || end !== stop.endTime) adjusted++;
      kept.push({ ...stop, startTime: start, endTime: end });
      prevEnd = end;
    }

    const stops: ItineraryStop[] = [];

    if (day.date === w.departDate) {
      stops.push({
        ...(existingDepart ?? {
          placeId: "origin",
          name: "Leave home",
          kind: "depart" as const,
          famousFor: "The drive out.",
          why: "Timed to the departure you gave us.",
          isHighlight: false,
          optional: false,
        }),
        placeId: "origin",
        kind: "depart",
        startTime: w.departTime,
        endTime: w.arrivalDate === w.departDate ? w.arrivalTime : "23:59",
      });
    }

    stops.push(...kept);

    if (day.date === lastDate) {
      stops.push({
        ...(existingHome ?? {
          placeId: "origin",
          name: "Drive home",
          kind: "drive_home" as const,
          famousFor: "The road back.",
          why: "Timed so you are home by the time you asked for.",
          isHighlight: false,
          optional: false,
        }),
        placeId: "origin",
        kind: "drive_home",
        startTime: w.latestDepartureTime,
        endTime: w.returnTime,
      });
    }

    return { ...day, stops };
  });

  const check = itinerarySchema.safeParse({ ...itinerary, days });
  if (!check.success) return { itinerary, adjusted: 0 };
  return { itinerary: check.data, adjusted };
}

/** Which pool categories can legitimately serve each stop kind. */
const KIND_SOURCES: Record<string, string[]> = {
  breakfast: ["breakfast", "cafe"],
  coffee: ["cafe", "dessert"],
  lunch: ["food"],
  dinner: ["food"],
  dessert: ["dessert", "cafe"],
  sight: ["attraction"],
  outdoor: ["nature"],
  activity: ["attraction", "nature"],
  viewpoint: ["nature", "attraction"],
  shopping: ["shopping"],
  evening: ["nightlife"],
};

/** Where each kind naturally sits in a day, used to place a backfilled stop. */
const KIND_TARGET_TIME: Record<string, string> = {
  breakfast: "08:30", coffee: "10:30", sight: "11:00", outdoor: "11:30",
  lunch: "13:00", activity: "15:00", shopping: "16:00", dessert: "16:30",
  viewpoint: "17:30", dinner: "19:30", evening: "21:00",
};

const EXPERIENCE_KINDS = new Set(["sight", "outdoor", "activity", "viewpoint"]);

/** What each slot is actually for, in words a person would use. */
const SLOT_LABEL: Record<string, string> = {
  breakfast: "breakfast", lunch: "lunch", dinner: "dinner",
  coffee: "a coffee break", dessert: "something sweet",
  sight: "the day's sightseeing", outdoor: "time outdoors",
  activity: "an afternoon activity", viewpoint: "golden hour",
  shopping: "a wander through the shops", evening: "the evening",
};

/** "hiking_area" -> "hiking area". The most specific true label Google gives us. */
function humanType(place: EnrichedPlace): string {
  const raw = place.primaryType || place.types?.[0] || place.category;
  return raw.replace(/_/g, " ").toLowerCase();
}

function tidy(text: string | undefined, max = 400): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 15) return undefined;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Prose for a backfilled stop, built ONLY from what Google actually says about
 * the place.
 *
 * "4.7/5 from 9,675 ratings" is not a reason to go anywhere — nobody picks a
 * waterfall off its rating, and the UI never shows one. So famousFor and why
 * each take a DIFFERENT real source, so they say two things rather than
 * restating one. When a place has no written description at all, the fallback
 * says plainly what it is and which part of the day it is filling, rather than
 * inventing a reputation for it.
 */
function describeBackfill(
  place: EnrichedPlace,
  kind: string,
): { famousFor: string; why: string } {
  const editorial = tidy(place.editorialSummary);
  const summary = tidy(place.reviewSummary);
  const type = humanType(place);

  const famousFor = editorial ?? summary ?? `A ${type} in the area.`;
  // Whichever written source famousFor did not already use.
  const spare = famousFor === editorial ? summary : undefined;

  // Real visitor commentary, labelled as such. Long reviews carry detail;
  // "Nice place!" carries none, so short ones are skipped.
  const reviewLine = (place.reviews ?? [])
    .map((r) => tidy(sanitizeReview(r), 220))
    .filter((r): r is string => r !== undefined && r.length >= 40)
    .sort((a, b) => b.length - a.length)[0];

  const why =
    spare ??
    (reviewLine ? `What visitors single out: ${reviewLine}` : undefined) ??
    `A ${type} close to the day's other stops, picked for ${SLOT_LABEL[kind] ?? "this part of the day"}.`;

  return { famousFor, why };
}

/**
 * GUARANTEED-OUTPUT LAYER.
 *
 * The repair loop gives the model several chances to build a full day, and it
 * usually does. When it does not — Flash-Lite losing the thread on a long
 * structured document is the common case — the choice is between showing the
 * traveller a three-stop day and filling the gaps from the same real, enriched
 * place data the model was working from.
 *
 * This is the same reasoning as the schedule repair in normalizeItinerary:
 * arithmetic and gap-filling are what code gets right and a small model gets
 * wrong. It never invents a place — every backfilled stop is a real finalist
 * with real ratings — and the prose is deliberately plain rather than
 * pretending to cite something the traveller said.
 */
function backfillThinDays(
  itinerary: Itinerary,
  refMap: Map<string, EnrichedPlace>,
): { itinerary: Itinerary; added: number } {
  const used = new Set<string>();
  for (const day of itinerary.days) {
    for (const s of day.stops) used.add(s.placeId);
    for (const a of day.alternates) used.add(a.placeId);
  }

  let added = 0;

  const days = itinerary.days.map((day) => {
    if (day.stops.length >= TARGET_STOPS_PER_DAY) return day;

    const kinds = new Set<string>(day.stops.map((s) => s.kind));
    const capacity = 9 - day.stops.length;
    const wanted: string[] = [];

    // Meals first — a day missing them is obviously incomplete.
    for (const meal of ["breakfast", "lunch", "dinner"]) {
      if (!kinds.has(meal)) wanted.push(meal);
    }

    // Then up to the two-experience floor the balance rules require.
    let experiences = day.stops.filter((s) => EXPERIENCE_KINDS.has(s.kind)).length;
    for (const k of ["sight", "outdoor", "viewpoint", "activity"]) {
      if (experiences >= 2) break;
      wanted.push(k);
      experiences++;
    }

    // Then contrast. This list is deliberately longer than needed — entries get
    // skipped when their slot has already passed or the category is exhausted,
    // and the pick loop below stops as soon as the day is full.
    for (const k of ["coffee", "viewpoint", "shopping", "dessert", "evening", "sight", "outdoor", "activity"]) {
      if (!kinds.has(k) && !wanted.includes(k)) wanted.push(k);
    }

    // The day's real window. The drive home is a hard ceiling, and the arrival
    // is a floor — a day you reach at 11:00 does not get a breakfast stop just
    // because the day was thin.
    const homeStop = day.stops.find((s) => s.kind === "drive_home");
    const departStop = day.stops.find((s) => s.kind === "depart");
    const ceiling = homeStop?.startTime ?? "23:00";
    const floor = departStop?.endTime ?? "00:00";

    const additions: ItineraryStop[] = [];
    for (const kind of wanted) {
      if (additions.length >= capacity) break;
      if (day.stops.length + additions.length >= TARGET_STOPS_PER_DAY) break;
      const start = KIND_TARGET_TIME[kind] ?? "12:00";
      if (start >= ceiling || start < floor) continue;

      let picked: [string, EnrichedPlace] | undefined;
      for (const cat of KIND_SOURCES[kind] ?? []) {
        const candidates = [...refMap.entries()]
          .filter(([ref, p]) => !used.has(ref) && p.category === cat)
          .sort((a, b) => confidenceScore(b[1]) - confidenceScore(a[1]));
        if (candidates.length) {
          picked = candidates[0];
          break;
        }
      }
      if (!picked) continue;

      const [ref, place] = picked;
      used.add(ref);
      added++;

      const { famousFor, why } = describeBackfill(place, kind);

      additions.push({
        placeId: ref,
        name: place.name,
        kind: kind as ItineraryStop["kind"],
        startTime: start,
        endTime: start,
        famousFor,
        why,
        isHighlight: false,
        optional: false,
        ...(place.sparseData ? { headsUp: "Few ratings, so this one is less of a sure thing." } : {}),
      });
    }

    if (additions.length === 0) return day;

    // depart stays first and drive_home last; everything else sorts by clock.
    const middle = [...day.stops.filter((s) => !TRAVEL_KINDS.has(s.kind)), ...additions].sort(
      (a, b) => a.startTime.localeCompare(b.startTime),
    );

    return {
      ...day,
      stops: [
        ...(departStop ? [departStop] : []),
        ...middle,
        ...(homeStop ? [homeStop] : []),
      ],
    };
  });

  // normalizeItinerary owns the schedule arithmetic — reuse it rather than
  // reimplementing overlap repair here, then confirm the result still parses.
  const repaired = normalizeItinerary({ ...itinerary, days });
  const check = itinerarySchema.safeParse(repaired);
  if (!check.success) return { itinerary, added: 0 };

  return { itinerary: check.data, added };
}

/**
 * Swaps short refs back for real Google place ids, and takes the authoritative
 * name and travel time from the data rather than from the model.
 */
function hydrateRefs(itinerary: Itinerary, refMap: Map<string, EnrichedPlace>): Itinerary {
  const hydrateStop = (stop: Itinerary["days"][0]["stops"][0]) => {
    if (TRAVEL_KINDS.has(stop.kind)) return stop;
    const place = refMap.get(stop.placeId);
    if (!place) return stop;
    return { ...stop, placeId: place.id, name: place.name };
  };

  return {
    ...itinerary,
    days: itinerary.days.map((day) => {
      const stops = day.stops.map(hydrateStop);

      // Travel time between stops is arithmetic, not judgment. Computing it
      // from real coordinates is both more accurate than a model guess and one
      // less field the model has to get right.
      const withTravel = stops.map((stop, i) => {
        if (i === 0 || TRAVEL_KINDS.has(stop.kind)) return stop;
        const prev = refMap.get(day.stops[i - 1].placeId) ?? null;
        const here = refMap.get(day.stops[i].placeId) ?? null;
        if (!prev || !here) return stop;
        const km = haversineKm(prev, here);
        if (km < 0.4) return { ...stop, travelFromPrevious: "a short walk" };
        const mins = Math.max(5, Math.round((km / 32) * 60));
        return { ...stop, travelFromPrevious: `about ${mins} min (${km.toFixed(1)} km)` };
      });

      return {
        ...day,
        stops: withTravel,
        alternates: day.alternates
          .map((a) => {
            const place = refMap.get(a.placeId);
            return place ? { ...a, placeId: place.id, name: place.name } : a;
          })
          .filter((a) => a.placeId),
      };
    }),
  };
}

/**
 * SEMANTIC OUTPUT CHECKS.
 *
 * Schema validation proves the shape is right; these prove the content is.
 * Every failure is fed back as a specific correction rather than rendered.
 */
function verifyItinerary(
  v: Itinerary,
  validIds: Set<string>,
  dates: string[],
  foodFocused = false,
  window?: TripWindow,
): { hard: string[]; soft: string[] } {
  // HARD  — the itinerary is wrong and must never be shown: invented places,
  //         dates outside the trip, impossible times.
  // SOFT  — the itinerary is usable but not ideal: balance, pacing, thin days.
  //         Worth a repair attempt; never worth showing the user an error.
  const issues: string[] = [];
  const soft: string[] = [];

  const allStops = v.days.flatMap((d) => d.stops);

  // Travel stops reference the traveller's own origin, which by definition is
  // not in the destination's place pool. Checking them against it was a bug.
  const invalid = allStops
    .filter((s) => !TRAVEL_KINDS.has(s.kind) && !validIds.has(s.placeId))
    .map((s) => `${s.name} (${s.placeId})`);
  if (invalid.length) {
    issues.push(
      `These stops are not in the supplied list: ${invalid.slice(0, 5).join(", ")}. Use only the ids provided.`,
    );
  }

  const badAlternates = v.days
    .flatMap((d) => d.alternates)
    .filter((a) => !validIds.has(a.placeId))
    .map((a) => a.name);
  if (badAlternates.length) {
    issues.push(`These alternates are not in the supplied list: ${badAlternates.slice(0, 5).join(", ")}.`);
  }

  if (v.days.length !== dates.length) {
    issues.push(`Expected exactly ${dates.length} day(s) (${dates.join(", ")}), got ${v.days.length}.`);
  }

  const wrongDates = v.days.map((d) => d.date).filter((d) => !dates.includes(d));
  if (wrongDates.length) {
    issues.push(`These dates are not part of the trip: ${wrongDates.join(", ")}. Use only ${dates.join(", ")}.`);
  }

  v.days.forEach((day, i) => {
    const highlights = day.stops.filter((s) => s.isHighlight).length;
    if (highlights !== 1) {
      soft.push(`Day ${i + 1} (${day.date}) has ${highlights} stops marked isHighlight. Every day needs exactly one.`);
    }

    if (day.stops.length < 5) {
      soft.push(
        `Day ${i + 1} only has ${day.stops.length} stops. Build a full day of 6-9 stops including meals — you have plenty of real places to work with.`,
      );
    }

    // Times must move forward. Overlapping stops are physically impossible.
    for (let s = 0; s < day.stops.length; s++) {
      const stop = day.stops[s];
      if (stop.endTime <= stop.startTime) {
        issues.push(`Day ${i + 1} "${stop.name}" ends at ${stop.endTime} but starts at ${stop.startTime}.`);
      }
      const prev = day.stops[s - 1];
      if (prev && stop.startTime < prev.endTime) {
        issues.push(`Day ${i + 1} "${stop.name}" starts at ${stop.startTime}, before "${prev.name}" ends at ${prev.endTime}.`);
      }
    }

    // A day of activities with no food in it is not a real day.
    const mealKinds = new Set(["breakfast", "lunch", "dinner", "coffee", "dessert"]);
    const foodStops = day.stops.filter((s) => mealKinds.has(s.kind)).length;
    if (day.stops.length >= 5 && foodStops === 0) {
      soft.push(`Day ${i + 1} has no meals or food stops. People eat.`);
    }

    // The opposite failure, and by far the more common one: restaurants
    // dominate the source data, so days drift into being mostly eating.
    const experienceKinds = new Set(["sight", "outdoor", "activity", "viewpoint"]);
    const experiences = day.stops.filter((s) => experienceKinds.has(s.kind)).length;

    if (day.stops.length >= 5 && foodStops > Math.ceil(day.stops.length * 0.45)) {
      soft.push(
        `Day ${i + 1} is ${foodStops} food stops out of ${day.stops.length} — that is a food tour, not a weekend. Replace some with sights, outdoor stops or activities.`,
      );
    }

    if (day.stops.length >= 5 && experiences < 2) {
      soft.push(
        `Day ${i + 1} only has ${experiences} experience stop(s). Every day needs at least two things to see or do beyond eating.`,
      );
    }
  });

  // The day's highlight should be something you go somewhere FOR.
  const foodKinds = new Set(["breakfast", "lunch", "dinner", "coffee", "dessert"]);
  if (!foodFocused && v.days.length > 0) {
    const foodHighlights = v.days
      .map((d) => d.stops.find((st) => st.isHighlight))
      .filter((st) => st && foodKinds.has(st.kind));
    if (foodHighlights.length === v.days.length) {
      soft.push(
        `Every day's highlight is a meal. Unless the trip is explicitly about food, the highlight should be something to see or do.`,
      );
    }
  }

  // Repeated ACTIVITIES read as padding. A hotel recurring across check-in and
  // check-out does not — that is just how staying somewhere works.
  const seen = new Set<string>();
  for (const stop of allStops) {
    if (REPEATABLE_KINDS.has(stop.kind) || TRAVEL_KINDS.has(stop.kind)) continue;
    if (seen.has(stop.placeId)) {
      soft.push(`"${stop.name}" appears more than once. Each place should appear at most once.`);
      break;
    }
    seen.add(stop.placeId);
  }

  // The clock. SOFT rather than hard on purpose: enforceTripWindow guarantees
  // these in code afterwards, so a violation is worth one corrective retry —
  // the model writes a better day than the clamp does — but never worth
  // failing the request over.
  if (window) {
    for (const day of v.days) {
      for (const stop of day.stops) {
        if (TRAVEL_KINDS.has(stop.kind)) continue;
        if (day.date === window.arrivalDate && stop.startTime < window.arrivalTime) {
          soft.push(
            `"${stop.name}" starts at ${stop.startTime} on ${day.date}, but they do not arrive until ${window.arrivalTime}. Nothing can happen before they get there.`,
          );
        }
        if (day.date === window.latestDepartureDate && stop.endTime > window.latestDepartureTime) {
          soft.push(
            `"${stop.name}" runs to ${stop.endTime}, past the ${window.latestDepartureTime} they must leave by to be home at ${window.returnTime}. Move it earlier or drop it.`,
          );
        }
      }
    }
  }

  return { hard: issues, soft };
}

export { verifyItinerary, backfillThinDays, enforceTripWindow };
export const COMPOSE_LIMITS = { maxReviews: LIMITS.MAX_REVIEWS_PER_PLACE };
