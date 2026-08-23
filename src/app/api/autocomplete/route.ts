import { NextRequest } from "next/server";
import { Budget } from "@/lib/budget";
import { env } from "@/lib/config";
import { fetchJson } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Proxies Places Autocomplete.
 *
 * The API key must never reach the browser, which rules out the client-side
 * Places widget. Proxying keeps one server-side key that can stay
 * referrer-unrestricted.
 */
export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (input.length < 2 || input.length > 160) {
    return Response.json({ suggestions: [] });
  }

  const budget = new Budget();

  try {
    const data = await fetchJson<{
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
        };
      }>;
    }>({
      api: "Places:autocomplete",
      url: "https://places.googleapis.com/v1/places:autocomplete",
      method: "POST",
      headers: { "X-Goog-Api-Key": env().GOOGLE_MAPS_API_KEY },
      body: {
        input,
        // "(cities)" is a valid type collection. It cannot be mixed with
        // specific types — doing so is rejected as INVALID_REQUEST.
        includedPrimaryTypes: ["(cities)"],
      },
      budget,
      sku: "places:autocomplete",
      maxRetries: 1,
    });

    const suggestions = (data.suggestions ?? [])
      .map((s) => {
        const p = s.placePrediction;
        return {
          placeId: p?.placeId ?? "",
          label: p?.text?.text ?? "",
          main: p?.structuredFormat?.mainText?.text ?? p?.text?.text ?? "",
          secondary: p?.structuredFormat?.secondaryText?.text ?? "",
        };
      })
      .filter((s) => s.placeId && s.label)
      .slice(0, 6);

    return Response.json({ suggestions });
  } catch (e) {
    // Previously this failed silently, which is indistinguishable from "no
    // matches" and hid a broken key or a disabled API for as long as you cared
    // to look. Log it, and tell the client it was an error rather than a miss.
    console.error("[autocomplete] failed:", e instanceof Error ? e.message : e);
    return Response.json({ suggestions: [], error: true }, { status: 200 });
  }
}

/**
 * Resolves a chosen suggestion to coordinates.
 *
 * Takes the placeId rather than re-geocoding the label: the id is already an
 * exact match for what the user picked, so this cannot drift to a different
 * city that happens to share a name.
 */
export async function POST(req: NextRequest) {
  let body: { placeId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const placeId = body.placeId?.trim();
  if (!placeId || placeId.length > 300) {
    return Response.json({ error: "Pick a city from the list" }, { status: 400 });
  }

  try {
    const data = await fetchJson<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude: number; longitude: number };
    }>({
      api: "Places:details",
      url: `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      headers: {
        "X-Goog-Api-Key": env().GOOGLE_MAPS_API_KEY,
        // Essentials-tier fields only — this is the cheapest possible lookup.
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
      },
      budget: new Budget(),
      sku: "places:details:essentials",
      maxRetries: 1,
    });

    if (!data.location) {
      return Response.json({ error: "Couldn't locate that city" }, { status: 404 });
    }

    return Response.json({
      name: data.formattedAddress ?? data.displayName?.text ?? "",
      lat: data.location.latitude,
      lng: data.location.longitude,
    });
  } catch (e) {
    console.error("[autocomplete:resolve] failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Lookup failed" }, { status: 502 });
  }
}
