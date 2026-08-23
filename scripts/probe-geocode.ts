import { Budget } from "../src/lib/budget";
import { geocode } from "../src/lib/maps/geocode";
import { arg, fail, heading, save } from "./_shared";

async function main() {
  const query = arg(0, "Bangalore, India");
  heading(`Geocoding — "${query}"`);
  try {
    const budget = new Budget();
    const result = await geocode(query, budget);
    console.log(result ? `\n  ${result.formattedAddress}\n  ${result.lat}, ${result.lng}` : "\n  No results");
    console.log(`\n  budget: ${JSON.stringify(budget.snapshot().bySku)}`);
    save("probe-geocode", result);
  } catch (e) {
    fail(e);
  }
}
main();
