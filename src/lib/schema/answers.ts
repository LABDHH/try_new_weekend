import { z } from "zod";
import { LIMITS } from "../limits";

/**
 * INPUT GUARDRAIL.
 *
 * This is the only door into the pipeline. Everything downstream — prompts,
 * API calls, cache keys — trusts that whatever passed through here is
 * structurally sound, temporally coherent, and length-bounded.
 */

export const DRIVE_BUCKETS = {
  under_1_5: { label: "Under 1.5 hrs", minHours: 0, maxHours: 1.5, blurb: "A short hop" },
  h1_5_to_3: { label: "1.5 – 3 hrs", minHours: 1.25, maxHours: 3, blurb: "Half a morning" },
  h3_to_5: { label: "3 – 5 hrs", minHours: 2.75, maxHours: 5, blurb: "Worth the drive" },
  over_5: { label: "5+ hrs", minHours: 4.5, maxHours: 8.5, blurb: "Go properly far" },
} as const;

export type DriveBucket = keyof typeof DRIVE_BUCKETS;

export const FOCUS_TAGS = {
  scenic: "Scenic & slow",
  food: "Food & drink",
  nature: "Nature & hikes",
  culture: "Culture & history",
  nightlife: "Nightlife",
  luxe: "Luxe & pampered",
  rustic: "Rustic & cozy",
  offbeat: "Offbeat & local",
  switch_off: "Just switching off",
} as const;

export const WHO = {
  solo: "Solo",
  couple: "Couple",
  friends: "Friends",
  family_kids: "Family with kids",
} as const;

export const BUDGET_LEVEL = {
  cheap: "Keep it cheap",
  comfortable: "Comfortable",
  treat: "Treat myself",
} as const;

const isoDateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "Not a valid date/time" });

export const answersSchema = z
  .object({
    origin: z.object({
      name: z.string().min(1).max(160),
      placeId: z.string().max(300).optional(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
    departAt: isoDateTime,
    returnBy: isoDateTime,
    driveBucket: z.enum(Object.keys(DRIVE_BUCKETS) as [DriveBucket, ...DriveBucket[]]),
    who: z.enum(Object.keys(WHO) as [keyof typeof WHO, ...(keyof typeof WHO)[]]),
    focus: z
      .array(z.enum(Object.keys(FOCUS_TAGS) as [keyof typeof FOCUS_TAGS, ...(keyof typeof FOCUS_TAGS)[]]))
      .max(4, "Pick at most four")
      .default([]),
    /** Free-text alternative to the tags. Either may be empty, but not both. */
    focusText: z.string().max(LIMITS.MAX_FREETEXT_CHARS).optional().default(""),
    budgetLevel: z.enum(
      Object.keys(BUDGET_LEVEL) as [keyof typeof BUDGET_LEVEL, ...(keyof typeof BUDGET_LEVEL)[]],
    ),
    freeText: z.string().max(LIMITS.MAX_FREETEXT_CHARS).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.focus.length === 0 && !v.focusText?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["focus"],
        message: "Pick at least one, or describe what you're after",
      });
    }

    const depart = new Date(v.departAt).getTime();
    const back = new Date(v.returnBy).getTime();

    if (back <= depart) {
      ctx.addIssue({
        code: "custom",
        path: ["returnBy"],
        message: "Return time must be after departure",
      });
      return;
    }

    // Routes API rejects a past departureTime for DRIVE mode, so a stale form
    // has to fail here rather than deep inside the routing call.
    // 5 minutes of slack absorbs clock skew and submit latency.
    if (depart < Date.now() - 5 * 60_000) {
      ctx.addIssue({
        code: "custom",
        path: ["departAt"],
        message: "Departure time is in the past",
      });
    }

    const windowHours = (back - depart) / 3_600_000;

    if (windowHours > 24 * 4) {
      ctx.addIssue({
        code: "custom",
        path: ["returnBy"],
        message: "This planner is built for trips up to 4 days",
      });
    }

    // Feasibility: a round trip must leave meaningfully more time at the
    // destination than in the car. Catching it here produces a clear form error
    // instead of an itinerary that is 80% driving.
    const driveHours = DRIVE_BUCKETS[v.driveBucket].maxHours;
    if (driveHours * 2 >= windowHours * 0.75) {
      ctx.addIssue({
        code: "custom",
        path: ["driveBucket"],
        message: `A ${driveHours}h each-way drive doesn't fit a ${Math.round(windowHours)}h trip. Pick a shorter drive or widen your dates.`,
      });
    }
  });

export type Answers = z.infer<typeof answersSchema>;

/** Nights away, used for itinerary day count and hotel decisions. */
export function tripDays(a: Answers): number {
  const depart = new Date(a.departAt);
  const back = new Date(a.returnBy);
  const startDay = new Date(depart.getFullYear(), depart.getMonth(), depart.getDate());
  const endDay = new Date(back.getFullYear(), back.getMonth(), back.getDate());
  return Math.round((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1;
}

/** Calendar dates the trip spans, as YYYY-MM-DD, for matching weather forecasts. */
export function tripDates(a: Answers): string[] {
  const out: string[] = [];
  const depart = new Date(a.departAt);
  for (let i = 0; i < tripDays(a); i++) {
    const d = new Date(depart.getFullYear(), depart.getMonth(), depart.getDate() + i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

export function maxDriveHours(a: Answers): number {
  return DRIVE_BUCKETS[a.driveBucket].maxHours;
}

export function minDriveHours(a: Answers): number {
  return DRIVE_BUCKETS[a.driveBucket].minHours;
}

/**
 * How well a real drive time matches what they asked for, 0-1.
 *
 * Inside the band scores 1. Outside it decays, and UNDER-shooting is penalised
 * harder than overshooting: someone who said "3-5 hours" is telling you they
 * want to get properly away, and handing them a 45-minute drive is a worse
 * answer than one that runs twenty minutes long.
 */
export function driveBandFit(a: Answers, driveSeconds: number): number {
  const hours = driveSeconds / 3600;
  const { minHours, maxHours } = DRIVE_BUCKETS[a.driveBucket];
  if (hours >= minHours && hours <= maxHours) return 1;
  if (hours < minHours) return Math.max(0, 1 - ((minHours - hours) / Math.max(minHours, 1)) * 1.4);
  return Math.max(0, 1 - (hours - maxHours) / 1.5);
}
