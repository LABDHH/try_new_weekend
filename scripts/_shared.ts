import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function save(name: string, data: unknown): void {
  const dir = resolve(process.cwd(), "fixtures");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`\n  saved -> fixtures/${name}.json`);
}

export function heading(title: string): void {
  console.log(`\n${"=".repeat(60)}\n  ${title}\n${"=".repeat(60)}`);
}

export function arg(index: number, fallback: string): string {
  return process.argv[index + 2] ?? fallback;
}

/** Probes hit live paid APIs, so failures must be loud and specific. */
export function fail(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`\n  FAILED: ${msg}\n`);
  if (msg.includes("REQUEST_DENIED") || msg.includes("403")) {
    console.error("  Likely causes:");
    console.error("   - Maps key is restricted by HTTP referrer (use API restrictions instead)");
    console.error("   - The API isn't enabled on the Cloud project");
    console.error("   - No billing account attached\n");
  }
  process.exit(1);
}
