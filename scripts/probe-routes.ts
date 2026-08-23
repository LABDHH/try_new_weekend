import { Budget } from "../src/lib/budget";
import { geocode } from "../src/lib/maps/geocode";
import { driveTimes } from "../src/lib/maps/routes";
import { arg, fail, heading, save } from "./_shared";

/** Confirms TRAFFIC_AWARE_OPTIMAL works with a future departureTime. */
async function main() {
  const from = arg(0, "Bangalore, India");
  const targets = ["Coorg, Karnataka", "Mysore, Karnataka", "Chikmagalur, Karnataka", "Ooty, Tamil Nadu"];

  heading(`Routes — traffic-aware matrix from "${from}"`);

  try {
    const budget = new Budget();
    const origin = await geocode(from, budget);
    if (!origin) return fail(new Error(`Could not geocode "${from}"`));

    const dests = [];
    for (const t of targets) {
      const g = await geocode(t, budget);
      if (g) dests.push({ name: t, ...g });
    }

    // Next Saturday 07:00 — a realistic departure, and safely in the future.
    const depart = new Date();
    depart.setDate(depart.getDate() + ((6 - depart.getDay() + 7) % 7 || 7));
    depart.setHours(7, 0, 0, 0);
    console.log(`\n  departureTime: ${depart.toISOString()}`);

    const legs = await driveTimes(origin, dests, depart, budget);
    console.log(`\n  ${legs.length}/${dests.length} routes resolved (1 billed matrix call)\n`);
    for (const leg of legs) {
      const d = dests[leg.destinationIndex];
      console.log(`   ${d.name.padEnd(28)} ${(leg.seconds / 3600).toFixed(1)}h  ${Math.round(leg.meters / 1000)}km`);
    }

    console.log(`\n  budget: ${JSON.stringify(budget.snapshot().bySku)}`);
    save("probe-routes", { origin, dests, legs });
  } catch (e) {
    fail(e);
  }
}
main();
