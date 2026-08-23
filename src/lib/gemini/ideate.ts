import type { Budget } from "../budget";
import { LIMITS } from "../config";
import { DRIVE_BUCKETS, tripDays, type Answers } from "../schema/answers";
import { ideationSchema, type Ideation } from "../schema/itinerary";
import { generateStructured } from "./client";
import { renderProfile } from "./profile";

const SYSTEM = `
You are a regional travel expert with deep knowledge of what lies within
driving distance of any given city — the towns, hill stations, coasts, heritage
sites, national parks and lake districts people actually go to for a weekend,
and crucially, which of them are worth it and when.

Your ONLY job here is to name candidate destinations and reason about them.
You are not building an itinerary and you are not naming specific businesses.

# Think before you list

Start by writing the brief: what does this specific traveller actually need?
Read their free text especially carefully — it usually contains the real
constraint. Only after that should you name anywhere.

# How to choose candidates — apply every one of these

1. DISTANCE BAND IS THE HARD FILTER.
   They gave you a target range, not a ceiling. Estimate the real ROAD driving
   time — not straight-line distance, and not optimistic highway maths. Hill
   roads, ghat sections and single-lane stretches are slow.
   Reject anything meaningfully below the band's lower bound. A 40-minute
   suburb when they asked for 3-5 hours is a failed answer, not a safe one.

2. IT MUST WORK AS A TRIP OF THIS LENGTH.
   A place worth four days is not automatically worth one night. If the drive
   eats most of the window, the destination has to justify it.

3. ALL-ROUND, NOT ONE-NOTE.
   A good weekend destination offers several DIFFERENT kinds of day: something
   to see, something outdoors, somewhere to eat well, somewhere to sit still.
   List those in "offers". If a place only supports one activity, it is a weak
   candidate unless that one thing is exactly what they asked for.

4. SEASON AND TIMING ARE NOT OPTIONAL.
   Consider what that place is like in this specific month. A hill station in
   heavy monsoon, a desert in peak summer, a beach town out of season, a park
   that is closed for the season — say so in seasonNote. Sometimes the honest
   answer is "great in November, wrong in July".

5. FIT THE GROUP.
   Kids need short walks, toilets and somewhere to run. Couples want quiet and
   good dinners. Friends want somewhere with an evening. Solo travellers need
   places that are comfortable alone. This changes the list.

6. HONOUR THE FREE TEXT ABSOLUTELY.
   If they said no beaches, propose no beaches. If they said somewhere quiet,
   do not propose the busiest tourist town in the region. If they mentioned a
   dietary need or a mobility limit, only propose places that can serve it.

7. GIVE THEM A REAL CHOICE.
   Vary the list — do not return six versions of the same hill station. Mix the
   obvious strong option with one or two less predictable ones that genuinely
   fit. But every entry must be defensible; do not pad the list with places you
   would not actually recommend.

8. BE HONEST WITH CONFIDENCE.
   Score 5 only when you are certain the place exists, is reachable by road in
   roughly that time, and is worth going to. Score low when unsure. A low score
   is far more useful than a confident guess — these get verified against real
   routing data, and a wrong estimate simply wastes a slot.

# Naming
Use the common name plus its state or region so it can be geocoded:
"Coorg, Karnataka" not "Coorg". Name a place, not a vibe.
`.trim();

/**
 * STAGE 1 — destination ideation.
 *
 * The step with no Google API equivalent: nothing in Maps answers "which towns
 * are worth driving to for a weekend?". World knowledge does — and every name
 * it produces is then ground-truthed by geocoding and a real traffic-aware
 * drive time before it can survive.
 *
 * The schema forces a written brief and per-candidate reasoning before any
 * conclusion, because a list produced straight from preferences is noticeably
 * more random than one produced after stating the constraints.
 */
export async function ideateDestinations(
  answers: Answers,
  budget: Budget,
): Promise<Ideation> {
  const band = DRIVE_BUCKETS[answers.driveBucket];
  const days = tripDays(answers);

  const prompt = `
${renderProfile(answers)}

## Your task

First write the brief: what does this traveller actually need from this weekend?

Then propose up to ${LIMITS.IDEATE_DESTINATIONS} candidate destinations reachable by
ROAD from ${answers.origin.name} in ${band.minHours}-${band.maxHours} hours.

Aim the bulk of your list at ${band.minHours}-${band.maxHours} hours of real driving.
Anything under ${band.minHours} hours does not satisfy this request and should only
appear if it is genuinely exceptional for what they asked for.

This is a ${days}-day trip. Every candidate must be worth that drive for that
much time on the ground.

For each destination give:
- name with region, so it can be geocoded
- your honest estimated road driving hours from ${answers.origin.name}
- what it offers (several different kinds of thing to do, not one)
- how it matches what THIS traveller asked for
- whether this month is a good time to go there
- your confidence, 1-5
`.trim();

  return generateStructured({
    stage: "ideate",
    system: SYSTEM,
    prompt,
    schema: ideationSchema,
    budget,
    // Low temperature: this stage was producing scattershot lists. Reasoning
    // quality matters far more than variety, and verification supplies the
    // filtering that randomness was never going to.
    temperature: 0.35,
  });
}
