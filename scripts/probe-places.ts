import { Budget } from "../src/lib/budget";
import { PLACE_CATEGORIES } from "../src/lib/limits";
import { geocode } from "../src/lib/maps/geocode";
import { enrichPlace, searchNearby } from "../src/lib/maps/places";
import { applyHygiene } from "../src/lib/pipeline/hygiene";
import { arg, fail, heading, save } from "./_shared";

/**
 * Verifies the central cost claim empirically: ONE Nearby Search call returns
 * up to 20 places WITH rating and review counts, rather than needing 20
 * separate Place Details calls for the same data.
 */
async function main() {
  const where = arg(0, "Coorg, Karnataka");
  heading(`Places — Nearby Search around "${where}"`);

  try {
    const budget = new Budget();
    const center = await geocode(where, budget);
    if (!center) return fail(new Error(`Could not geocode "${where}"`));

    const all = [];
    for (const cat of PLACE_CATEGORIES) {
      const found = await searchNearby(center, cat.key, budget);
      const withRating = found.filter((p) => p.rating !== undefined).length;
      console.log(`\n  ${cat.label.padEnd(26)} ${String(found.length).padStart(2)} places, ${withRating} with ratings`);
      for (const p of found.slice(0, 3)) {
        console.log(`     - ${p.name} — ${p.rating ?? "n/a"} (${p.ratingCount ?? 0})`);
      }
      all.push(...found);
    }

    const { kept, dropped } = applyHygiene(all);
    console.log(`\n  raw: ${all.length}  ->  after hygiene: ${kept.length}`);
    console.log(`  dropped: ${JSON.stringify(dropped)}`);

    // One enrichment call, to confirm the expensive SKU returns what we expect.
    if (kept.length > 0) {
      const sample = kept.find((p) => (p.ratingCount ?? 0) > 100) ?? kept[0];
      console.log(`\n  Enriching one place (Enterprise+Atmosphere SKU): ${sample.name}`);
      const rich = await enrichPlace(sample.id, budget);
      console.log(`     reviewSummary: ${rich.reviewSummary ? "yes" : "no"}`);
      console.log(`     reviews returned: ${rich.reviews.length}`);
      if (rich.reviewSummary) console.log(`     "${rich.reviewSummary.slice(0, 140)}..."`);
    }

    console.log(`\n  budget: ${JSON.stringify(budget.snapshot().bySku)}`);
    save("probe-places", { center, kept, dropped });
  } catch (e) {
    fail(e);
  }
}
main();
