import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { answersSchema } from "../src/lib/schema/answers";
import { planTrip } from "../src/lib/pipeline/orchestrate";
import type { PlanEvent } from "../src/lib/schema/events";
import { arg, fail, heading, save } from "./_shared";

/**
 * The whole pipeline, headless. No browser, no server.
 *
 * This is where itinerary quality actually gets tuned — you will iterate the
 * prompts dozens of times, and doing that here rather than through the UI is
 * the single biggest velocity win in the build.
 */

/** Fixtures use AUTO_ placeholders so they never go stale and fail date validation. */
function resolveDates(raw: Record<string, unknown>): Record<string, unknown> {
  const nextDow = (dow: number, h: number, m: number) => {
    const d = new Date();
    const delta = (dow - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + delta);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  const map = (v: unknown): unknown => {
    if (typeof v !== "string" || !v.startsWith("AUTO_")) return v;
    const m = /^AUTO_NEXT_(\w+?)_(\d{2}):(\d{2})$/.exec(v);
    if (!m) return v;
    const days: Record<string, number> = {
      SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3,
      THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
    };
    const dow = days[m[1].toUpperCase()];
    if (dow === undefined) return v;
    return nextDow(dow, Number(m[2]), Number(m[3]));
  };

  return { ...raw, departAt: map(raw.departAt), returnBy: map(raw.returnBy) };
}

async function main() {
  const file = arg(0, "fixtures/answers-bangalore.json");
  heading(`Planning from ${file}`);

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8"));
  } catch (e) {
    return fail(e);
  }

  const parsed = answersSchema.safeParse(resolveDates(raw));
  if (!parsed.success) {
    console.error("\n  Answers failed validation:");
    for (const i of parsed.error.issues) {
      console.error(`   - ${i.path.join(".") || "(root)"}: ${i.message}`);
    }
    process.exit(1);
  }

  const started = Date.now();
  const onEvent = (e: PlanEvent) => {
    if (e.type === "stage") console.log(`  [${String((Date.now() - started) / 1000).padStart(5)}s] ${e.message}`);
    if (e.type === "destinations") console.log(`          candidates: ${e.names.join(", ")}`);
    if (e.type === "chosen") console.log(`          chosen: ${e.name} (${e.driveMinutes} min)`);
  };

  try {
    const { itinerary, debug } = await planTrip(parsed.data, onEvent);

    heading(itinerary.destinationName);
    console.log(`\n  ${itinerary.whyHere}\n`);
    console.log(`  ${itinerary.travelNote}\n`);

    console.log(`  Known for: ${itinerary.knownFor}\n`);

    for (const day of itinerary.days) {
      console.log(`\n  ${day.date} — ${day.title}`);
      console.log(`  ${day.narrative}`);
      if (day.weatherNote) console.log(`  weather: ${day.weatherNote}`);
      for (const s of day.stops) {
        const tag = s.isHighlight ? "*" : s.optional ? "~" : " ";
        console.log(`   ${tag} ${s.startTime}-${s.endTime}  ${s.name}  [${s.kind}]`);
        console.log(`       famous for: ${s.famousFor}`);
        console.log(`       detail: ${s.detail}`);
        if (s.travelFromPrevious) console.log(`       getting there: ${s.travelFromPrevious}`);
        if (s.headsUp) console.log(`       heads up: ${s.headsUp}`);
      }
      if (day.alternates.length) {
        console.log(`     alternates:`);
        for (const alt of day.alternates) {
          console.log(`       - ${alt.name} (instead of ${alt.insteadOf}): ${alt.why}`);
        }
      }
    }

    if (itinerary.beforeYouGo.length) {
      console.log("\n  Before you go:");
      for (const b of itinerary.beforeYouGo) console.log(`   - ${b}`);
    }

    if (itinerary.caveats.length) {
      console.log("\n  Caveats:");
      for (const c of itinerary.caveats) console.log(`   - ${c}`);
    }

    console.log(`\n  debug: ${JSON.stringify(debug, null, 2)}`);
    save("last-itinerary", { itinerary, debug });
  } catch (e) {
    fail(e);
  }
}
main();
