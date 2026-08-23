import { Budget } from "../src/lib/budget";
import { geocode } from "../src/lib/maps/geocode";
import { forecastForDates } from "../src/lib/maps/weather";
import { arg, fail, heading, save } from "./_shared";

/** Also exercises the past-horizon path: day 20 must report unavailable, not guess. */
async function main() {
  const where = arg(0, "Coorg, Karnataka");
  heading(`Weather — forecast for "${where}"`);

  try {
    const budget = new Budget();
    const at = await geocode(where, budget);
    if (!at) return fail(new Error(`Could not geocode "${where}"`));

    const dates: string[] = [];
    for (const offset of [1, 2, 3, 20]) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }

    const forecast = await forecastForDates(at, dates, budget);
    console.log("");
    for (const f of forecast) {
      console.log(
        f.available
          ? `   ${f.date}  ${f.summary}, ${Math.round(f.minC ?? 0)}-${Math.round(f.maxC ?? 0)}C, rain ${f.precipitationPercent ?? 0}%`
          : `   ${f.date}  (past the 10-day horizon — reported as unavailable)`,
      );
    }

    console.log(`\n  budget: ${JSON.stringify(budget.snapshot().bySku)}`);
    save("probe-weather", forecast);
  } catch (e) {
    fail(e);
  }
}
main();
