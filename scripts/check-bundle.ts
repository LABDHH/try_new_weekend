import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Fails if anything server-side reaches the browser bundle.
 *
 * Checks two distinct things:
 *   1. Real secret VALUES (a deployed-key disaster).
 *   2. The env schema's field names — no secret escapes, but it means server
 *      config is being bundled, which is how a real leak starts.
 */
const FORBIDDEN: Array<[string, RegExp, "critical" | "warning"]> = [
  ["Google API key value", /AIza[A-Za-z0-9_-]{30,}/, "critical"],
  ["Gemini API key value", /AQ\.[A-Za-z0-9_-]{30,}/, "critical"],
  ["Supabase service role JWT", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, "critical"],
  ["env schema in client bundle", /GEMINI_API_KEY|GOOGLE_MAPS_API_KEY|SUPABASE_SERVICE_ROLE_KEY/, "warning"],
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|css|json)$/.test(entry)) out.push(full);
  }
  return out;
}

const dir = ".next/static";
let files: string[];
try {
  files = walk(dir);
} catch {
  console.error(`\n  ${dir} not found — run \`npm run build\` first.\n`);
  process.exit(1);
}

console.log(`\n  Scanning ${files.length} client files for server-side material\n`);

let critical = 0;
let warnings = 0;

for (const [label, pattern, severity] of FORBIDDEN) {
  const hits = files.filter((f) => pattern.test(readFileSync(f, "utf8")));
  if (hits.length === 0) {
    console.log(`   ok        ${label}`);
  } else if (severity === "critical") {
    critical++;
    console.log(`   CRITICAL  ${label} — ${hits.length} file(s): ${hits[0]}`);
  } else {
    warnings++;
    console.log(`   WARNING   ${label} — ${hits.length} file(s): ${hits[0]}`);
  }
}

console.log("");
if (critical > 0) {
  console.error(`  ${critical} critical leak(s). Do NOT deploy.\n`);
  process.exit(1);
}
if (warnings > 0) {
  console.error(`  ${warnings} warning(s): server config is reaching the client bundle.\n`);
  process.exit(1);
}
console.log("  Client bundle is clean.\n");
