/**
 * Which of the four Maps APIs are actually enabled on this key's project?
 *
 * Run this first. Every other probe depends on these, and "not enabled" is by
 * far the most common setup failure — worth one cheap check that names exactly
 * which console page to open.
 */
import { heading } from "./_shared";

const KEY = process.env.GOOGLE_MAPS_API_KEY;

const CONSOLE: Record<string, string> = {
  Geocoding: "https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com",
  "Places (New)": "https://console.cloud.google.com/apis/library/places.googleapis.com",
  Routes: "https://console.cloud.google.com/apis/library/routes.googleapis.com",
  Weather: "https://console.cloud.google.com/apis/library/weather.googleapis.com",
};

type Probe = { name: string; run: () => Promise<Response> };

const probes: Probe[] = [
  {
    name: "Geocoding",
    run: () => fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=Bangalore&key=${KEY}`),
  },
  {
    name: "Places (New)",
    run: () =>
      fetch("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": KEY!,
          "X-Goog-FieldMask": "places.id",
        },
        body: JSON.stringify({
          includedTypes: ["cafe"],
          maxResultCount: 1,
          locationRestriction: { circle: { center: { latitude: 12.97, longitude: 77.59 }, radius: 1000 } },
        }),
      }),
  },
  {
    name: "Routes",
    run: () =>
      fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": KEY!,
          "X-Goog-FieldMask": "originIndex,destinationIndex,duration,status",
        },
        body: JSON.stringify({
          origins: [{ waypoint: { location: { latLng: { latitude: 12.97, longitude: 77.59 } } } }],
          destinations: [{ waypoint: { location: { latLng: { latitude: 12.29, longitude: 76.63 } } } }],
          travelMode: "DRIVE",
        }),
      }),
  },
  {
    name: "Weather",
    run: () =>
      fetch(
        `https://weather.googleapis.com/v1/forecast/days:lookup?key=${KEY}&location.latitude=12.97&location.longitude=77.59&days=1`,
      ),
  },
];

function classify(raw: string): "OK" | "NOT ENABLED" | "DENIED" | "BILLING" {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return "DENIED";
  }
  const node = Array.isArray(body) ? body[0] ?? {} : body;
  const rec = node as Record<string, unknown>;
  const err = (rec.error ?? {}) as Record<string, unknown>;
  const message = String(rec.error_message ?? err.message ?? "");
  const status = String(rec.status ?? err.status ?? "OK");

  if (/not activated|has not been used|is disabled/i.test(message)) return "NOT ENABLED";
  if (/billing/i.test(message)) return "BILLING";
  if (status === "REQUEST_DENIED" || status === "PERMISSION_DENIED") return "DENIED";
  return "OK";
}

async function main() {
  heading("Google Maps APIs — which are enabled?");

  if (!KEY) {
    console.error("\n  GOOGLE_MAPS_API_KEY is not set. Add it to .env.local.\n");
    process.exit(1);
  }
  console.log(`\n  key: ${KEY.length} chars, starts "${KEY.slice(0, 4)}"`);
  if (KEY.length !== 39 || !KEY.startsWith("AIza")) {
    console.log("  WARNING: Maps keys are normally 39 chars starting with 'AIza'.");
  }
  console.log("");

  const problems: string[] = [];

  for (const probe of probes) {
    let verdict: string;
    try {
      const res = await probe.run();
      verdict = classify(await res.text());
    } catch (e) {
      verdict = `ERROR (${e instanceof Error ? e.message : String(e)})`;
    }
    console.log(`   ${probe.name.padEnd(14)} ${verdict}`);
    if (verdict !== "OK") problems.push(probe.name);
  }

  if (problems.length === 0) {
    console.log("\n  All four enabled. Try: npm run plan:local\n");
    return;
  }

  console.log("\n  Enable these in the Cloud Console (same project as the key):");
  for (const name of problems) console.log(`   ${name}\n     ${CONSOLE[name]}`);
  console.log("\n  Billing must also be attached to the project, even for free-tier use.\n");
  process.exit(1);
}

main();
