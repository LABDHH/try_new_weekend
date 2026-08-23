import { listModels } from "../src/lib/gemini/client";
import { env } from "../src/lib/config";
import { fail, heading } from "./_shared";

/** Model IDs move fast. This asks your key what it can actually call. */
async function main() {
  heading("Gemini — available models");
  try {
    const models = await listModels();
    const flash = models.filter((m) => m.includes("flash"));
    console.log(`\n  Configured GEMINI_MODEL: ${env().GEMINI_MODEL}\n`);
    console.log("  Flash models available to this key:");
    for (const m of flash) console.log(`   - ${m.replace("models/", "")}`);
    console.log(`\n  (${models.length} models total)`);
  } catch (e) {
    fail(e);
  }
}
main();
