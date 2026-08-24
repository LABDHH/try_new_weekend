import { z } from "zod";

/**
 * OUTPUT FORMAT CONTRACT.
 *
 * One source of truth: this Zod schema both constrains generation (converted to
 * JSON Schema for Gemini's structured output) and validates what comes back.
 * They cannot drift apart, because they are the same object.
 */

export const stopSchema = z.object({
  /**
   * Must match an id from the supplied pool — EXCEPT for travel stops
   * (depart / drive_home), which reference the traveller's own origin and use
   * the sentinel "origin". Enforced in code, not by the prompt.
   */
  placeId: z.string().min(1).describe('Exact id from the supplied list, or "origin" for depart/drive_home stops.'),
  name: z.string().min(1).max(300),
  kind: z.enum([
    "depart", "checkin", "breakfast", "coffee", "sight", "outdoor",
    "lunch", "activity", "viewpoint", "shopping", "dinner", "evening", "dessert", "drive_home",
  ]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:MM"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:MM"),
  /** What this place is actually known for — the concrete draw, not adjectives. */
  famousFor: z.string().min(5).max(600).describe("What this place is concretely known for. 1-2 sentences, under 400 characters."),
  /**
   * A second concrete fact about the PLACE, from the review data.
   *
   * Deliberately not a justification. The traveller's answers decide what goes
   * into the itinerary; narrating that decision back at them ("since you
   * wanted somewhere scenic...") tells them only what they already know, and
   * a whole day of it reads like a form letter.
   */
  detail: z.string().min(5).max(600).describe("One more concrete fact about the place, from its reviews. Never address the traveller or explain the choice. Under 300 characters."),
  /** How you get here from the previous stop: "10 min walk", "25 min drive". */
  travelFromPrevious: z.string().max(160).optional().describe("Leave this out — it is computed from real coordinates."),
  /** Practical friction-remover: "book ahead", "closed Mondays", "cash only". */
  headsUp: z.string().max(400).optional().describe("Practical friction only: book ahead, closes early, cash only."),
  /** True for the one unmissable thing each day. */
  isHighlight: z.boolean(),
  optional: z.boolean(),
});

export const alternateSchema = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1),
  /** Which stop this replaces, and in what circumstance. */
  insteadOf: z.string().max(240).describe("The name of the stop this replaces."),
  why: z.string().min(5).max(600).describe("When and why you would swap to this instead."),
});

export const daySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1).max(240).describe("Short title for the day, a few words."),
  /** Two or three sentences setting up the shape of the day. */
  narrative: z.string().min(20).max(1200).describe("2-3 sentences setting up the shape of the day."),
  weatherNote: z.string().max(600).optional(),
  // Hard floor is deliberately far below the target. A genuinely thin
  // destination can have an honest 2-3 stop day, and a final day where the
  // drive home starts the previous evening is legitimately ONE stop. Rejecting
  // those costs the traveller their whole itinerary over an honest edge case.
  // verifyItinerary's soft check still nudges toward the 6-9 target.
  stops: z.array(stopSchema).min(1).max(12).describe("6 to 9 stops covering the whole day, meals included."),
  /** Swaps if something is closed, rained off, or not their thing. */
  alternates: z.array(alternateSchema).max(6).describe("2-4 swaps if something is closed or rained off."),
});

export const itinerarySchema = z.object({
  destinationName: z.string().min(1).max(200),
  /** The one line that has to earn trust immediately. */
  whyHere: z.string().min(15).max(900),
  /** What the area is genuinely known for, in concrete terms. */
  knownFor: z.string().min(15).max(900),
  travelNote: z.string().max(900),
  days: z.array(daySchema).min(1).max(4),
  /** Practical prep: what to carry, book, or know before leaving. */
  beforeYouGo: z.array(z.string().max(500)).max(8),
  /** Honest limitations: sparse data, weather risk, compromises made. */
  caveats: z.array(z.string().max(500)).max(8),
});

export type Itinerary = z.infer<typeof itinerarySchema>;
export type ItineraryStop = z.infer<typeof stopSchema>;
export type ItineraryAlternate = z.infer<typeof alternateSchema>;
export type ItineraryDay = z.infer<typeof daySchema>;

/** What Gemini returns at the shortlist stage. */
/**
 * The scoring step is not decoration. Requiring an explicit score per candidate
 * BEFORE the pick forces the model to weigh every dimension rather than
 * pattern-matching to whichever name it recognises. Same model, better answer.
 */
export const destinationScoreSchema = z.object({
  name: z.string().min(1).max(160),
  driveFit: z.number().min(0).max(10).describe("Does the real drive time hit the band they asked for? Undershooting scores low."),
  interestFit: z.number().min(0).max(10).describe("How well it serves their stated interests and free text."),
  varietyFit: z.number().min(0).max(10).describe("Does it support a full, varied trip rather than one activity?"),
  weatherFit: z.number().min(0).max(10).describe("How workable the forecast is for these specific dates."),
  groupFit: z.number().min(0).max(10).describe("Suitability for who is actually going."),
  dataQuality: z.number().min(0).max(10).describe("Are there enough well-rated real places to build a plan?"),
  total: z.number().min(0).max(60),
  verdict: z.string().max(400),
});

export const shortlistSchema = z.object({
  /** Every candidate scored before any is chosen. */
  scores: z.array(destinationScoreSchema).min(1).max(6),
  destinationName: z.string().min(1),
  whyThisDestination: z.string().min(10).max(700),
  /** Why the runners-up lost — keeps the comparison honest. */
  whyNotOthers: z.string().max(600).optional(),
  placeIds: z.array(z.string().min(1)).min(8).max(50),
  /** Forces the balance requirement to be acknowledged, not assumed. */
  balanceCheck: z
    .string()
    .max(400)
    .describe("State how many experience places vs food places you selected, and confirm the mix is right."),
});

export type Shortlist = z.infer<typeof shortlistSchema>;
export type DestinationScore = z.infer<typeof destinationScoreSchema>;

export const ideationSchema = z.object({
  /**
   * Forces the model to state its read of the brief BEFORE naming anywhere.
   * A conclusion reached after articulating the constraints is measurably
   * better than one produced straight from a list of preferences.
   */
  brief: z
    .string()
    .min(30)
    .max(900)
    .describe("What this traveller actually needs, in 2-3 sentences, before you name anywhere."),
  destinations: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        region: z.string().max(160).optional(),
        /** Their own estimate, checked later against a real traffic-aware route. */
        estimatedDriveHours: z.number().min(0).max(24),
        pitch: z.string().max(400),
        /** How it serves what they specifically asked for. */
        matchesInterests: z.string().max(500),
        /** Distinct kinds of things to do — the all-round test. */
        offers: z.array(z.string().max(120)).max(8),
        /** Whether this time of year actually works there. */
        seasonNote: z.string().max(400),
        /** 1-5. Low means "plausible but I am not certain". */
        confidence: z.number().min(1).max(5),
      }),
    )
    .min(1)
    .max(20),
});

export type Ideation = z.infer<typeof ideationSchema>;

/**
 * Gemini accepts only a subset of JSON Schema and rejects unknown keywords, so
 * the generated schema is stripped before it is sent.
 */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "output" }) as Record<string, unknown>;
  return strip(json) as Record<string, unknown>;
}

/**
 * Gemini accepts only a subset of JSON Schema. `minItems`/`maxItems` are
 * deliberately absent: sending them returns 400 INVALID_ARGUMENT (verified
 * against the live API). Nothing is lost — Zod still enforces those bounds when
 * the response is parsed, and violations feed back through the repair loop with
 * a clearer message than a schema rejection would give.
 */
const ALLOWED = new Set([
  "type", "properties", "required", "items", "enum", "description",
  "minimum", "maximum", "nullable", "format", "anyOf",
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!ALLOWED.has(key)) continue;
    // `properties` keys are user-defined field names, not schema keywords —
    // recurse into the values but never filter the keys themselves.
    if (key === "properties" && value && typeof value === "object") {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
        props[pk] = strip(pv);
      }
      out[key] = props;
    } else {
      out[key] = strip(value);
    }
  }
  return out;
}


/**
 * Cosmetic overruns should not cost a user their entire itinerary.
 *
 * Gemini's schema subset carries no maxLength, so the model genuinely cannot
 * see these limits — enforcing them by rejection means burning repair attempts
 * on a sentence being twelve characters too long. Structural problems
 * (invented places, wrong dates, impossible times) still fail loudly; only
 * length is quietly clamped.
 */

/** Stops that reference the traveller's own origin rather than a pooled place. */
export const TRAVEL_KINDS = new Set(["depart", "drive_home"]);

/** Stops that make sense as the one thing a day is built around. */
const HIGHLIGHT_KINDS = new Set(["sight", "outdoor", "activity", "viewpoint"]);

/**
 * A stay legitimately recurs — check in on arrival, check out on departure —
 * so it is exempt from the duplicate rule, as are travel stops.
 */
export const REPEATABLE_KINDS = new Set(["checkin", "depart", "drive_home"]);

const DEFAULT_MINUTES: Record<string, number> = {
  depart: 60, drive_home: 90, checkin: 30, breakfast: 45, coffee: 40,
  lunch: 60, dinner: 90, dessert: 30, sight: 75, outdoor: 120,
  activity: 90, viewpoint: 45, shopping: 60, evening: 90,
};

function defaultMinutes(kind: string): number {
  return DEFAULT_MINUTES[kind] ?? 60;
}

/**
 * Accepts the many shapes a model produces for a clock time and returns HH:MM.
 *
 * Handles "9:00", "09:00", "9:00 AM", "9.00pm", "0900", bare "9", and full
 * ISO timestamps. Returns undefined only when there is genuinely no time in
 * the value.
 */
export function coerceTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  const pad = (h: number, m: number) =>
    `${String(Math.max(0, Math.min(23, h))).padStart(2, "0")}:${String(Math.max(0, Math.min(59, m))).padStart(2, "0")}`;

  // ISO timestamp: take the clock portion.
  const isoMatch = /T(\d{1,2}):(\d{2})/.exec(raw);
  if (isoMatch) return pad(Number(isoMatch[1]), Number(isoMatch[2]));

  const meridiem = /(a\.?m\.?|p\.?m\.?)/i.exec(raw);
  const isPm = meridiem ? /^p/i.test(meridiem[1]) : false;
  const isAm = meridiem ? /^a/i.test(meridiem[1]) : false;

  // "9:00", "9.00", "9 00", "09:5"
  const hm = /(\d{1,2})\s*[:.\s]\s*(\d{1,2})/.exec(raw);
  if (hm) {
    let hour = Number(hm[1]);
    const minute = Number(hm[2]);
    if (isPm && hour < 12) hour += 12;
    if (isAm && hour === 12) hour = 0;
    return pad(hour, minute);
  }

  // "0900" / "1430"
  const compact = /^(\d{2})(\d{2})$/.exec(raw);
  if (compact) return pad(Number(compact[1]), Number(compact[2]));

  // Bare hour: "9", "9pm"
  const bare = /^(\d{1,2})/.exec(raw);
  if (bare) {
    let hour = Number(bare[1]);
    if (isPm && hour < 12) hour += 12;
    if (isAm && hour === 12) hour = 0;
    return pad(hour, 0);
  }

  return undefined;
}

export function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  return eh * 60 + em - (sh * 60 + sm);
}

export function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function normalizeItinerary(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;

  const clamp = (v: unknown, max: number) =>
    typeof v === "string" && v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v;

  const r = raw as Record<string, unknown>;

  r.destinationName = clamp(r.destinationName, 200);
  r.whyHere = clamp(r.whyHere, 900);
  r.knownFor = clamp(r.knownFor, 900);
  r.travelNote = clamp(r.travelNote, 900);

  if (Array.isArray(r.beforeYouGo)) {
    r.beforeYouGo = r.beforeYouGo.slice(0, 8).map((x) => clamp(x, 500));
  }
  if (Array.isArray(r.caveats)) {
    r.caveats = r.caveats.slice(0, 8).map((x) => clamp(x, 500));
  }

  if (Array.isArray(r.days)) {
    for (const day of r.days as Record<string, unknown>[]) {
      day.title = clamp(day.title, 240);
      day.narrative = clamp(day.narrative, 1200);
      day.weatherNote = clamp(day.weatherNote, 600);

      if (Array.isArray(day.alternates)) {
        day.alternates = (day.alternates as Record<string, unknown>[]).slice(0, 6).map((a) => ({
          ...a,
          name: clamp(a.name, 300),
          insteadOf: clamp(a.insteadOf, 240),
          why: clamp(a.why, 600),
        }));
      }

      if (Array.isArray(day.stops)) {
        day.stops = (day.stops as Record<string, unknown>[]).slice(0, 12).map((st) => ({
          ...st,
          name: clamp(st.name, 300),
          famousFor: clamp(st.famousFor, 600),
          // `why` is the old name for this field. Itineraries saved before the
          // rename still carry it, and the model occasionally reaches for it
          // too — neither is worth failing an otherwise good plan over.
          detail: clamp(st.detail ?? st.why, 600),
          travelFromPrevious: clamp(st.travelFromPrevious, 160),
          headsUp: clamp(st.headsUp, 400),
          // Booleans are required by the schema but easy for a model to omit.
          isHighlight: typeof st.isHighlight === "boolean" ? st.isHighlight : false,
          optional: typeof st.optional === "boolean" ? st.optional : false,
          // Travel stops have no pooled place; normalise them to the sentinel
          // so they never look like an invented location.
          placeId: TRAVEL_KINDS.has(String(st.kind)) ? "origin" : st.placeId,
        }));

        const stops = day.stops as Record<string, unknown>[];

        // Times arrive in whatever format the model felt like. Flash-Lite
        // routinely emits "9:00 AM" or "9:00" where the schema wants "09:00",
        // and rejecting an otherwise good itinerary over a leading zero is
        // indefensible. Coerce first, then repair the schedule.
        for (const st of stops) {
          st.startTime = coerceTime(st.startTime) ?? "09:00";
          st.endTime = coerceTime(st.endTime) ?? "10:00";
        }

        // Time arithmetic across a dozen stops is exactly what a small model
        // gets wrong, and exactly what code gets right. Repair the schedule
        // rather than rejecting an otherwise good itinerary over it.
        let previousEnd: string | null = null;
        for (const st of stops) {
          let start = st.startTime as string;
          let end = st.endTime as string;

          // A stop cannot begin before the previous one finished.
          if (previousEnd && start < previousEnd) {
            const duration = minutesBetween(start, end);
            start = previousEnd;
            end = addMinutes(previousEnd, duration > 0 ? duration : defaultMinutes(String(st.kind)));
          }

          // A stop that ends when it starts is malformed, not informative.
          if (end <= start) end = addMinutes(start, defaultMinutes(String(st.kind)));

          st.startTime = start;
          st.endTime = end;
          previousEnd = end;
        }

        // Exactly one highlight per day. Models drop or double this routinely;
        // picking one is a better outcome than failing the itinerary over it.
        const highlights = stops.filter((st) => st.isHighlight === true);
        if (highlights.length === 0) {
          const candidate =
            stops.find((st) => HIGHLIGHT_KINDS.has(String(st.kind))) ??
            stops.find((st) => !TRAVEL_KINDS.has(String(st.kind)));
          if (candidate) candidate.isHighlight = true;
        } else if (highlights.length > 1) {
          highlights.slice(1).forEach((st) => (st.isHighlight = false));
        }
      }
    }
  }

  return r;
}
