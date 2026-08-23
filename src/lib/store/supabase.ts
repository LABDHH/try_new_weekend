import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { supabaseCredentials } from "../config";
import type { Answers } from "../schema/answers";
import type { Itinerary } from "../schema/itinerary";

/**
 * Persistence is entirely optional.
 *
 * With SUPABASE_URL blank the app still works end to end — itineraries are
 * returned inline and share links are simply unavailable. That keeps local
 * development free of a required external dependency.
 */

let client: SupabaseClient | null = null;

function db(): SupabaseClient | null {
  const creds = supabaseCredentials();
  if (!creds) return null;
  if (!client) {
    client = createClient(creds.url, creds.key, { auth: { persistSession: false } });
  }
  return client;
}

/**
 * Cache key: the answers that actually change the result, plus the ISO week.
 * Week-scoping means a cached trip cannot outlive its weather forecast.
 */
export function cacheKey(a: Answers): string {
  const payload = JSON.stringify({
    origin: `${a.origin.lat.toFixed(3)},${a.origin.lng.toFixed(3)}`,
    departAt: a.departAt,
    returnBy: a.returnBy,
    driveBucket: a.driveBucket,
    who: a.who,
    focus: [...a.focus].sort(),
    budgetLevel: a.budgetLevel,
    freeText: a.freeText?.trim().toLowerCase() ?? "",
    week: isoWeek(new Date(a.departAt)),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

export type StoredTrip = {
  id: string;
  itinerary: Itinerary;
  destinationName: string;
  createdAt: string;
};

export async function findCached(key: string): Promise<StoredTrip | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from("trips")
      .select("id, itinerary, destination_name, created_at")
      .eq("cache_key", key)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return {
      id: data.id as string,
      itinerary: data.itinerary as Itinerary,
      destinationName: data.destination_name as string,
      createdAt: data.created_at as string,
    };
  } catch {
    // A cache miss and a cache outage should behave identically: just plan it.
    return null;
  }
}

export async function saveTrip(opts: {
  cacheKey: string;
  answers: Answers;
  itinerary: Itinerary;
  destinationName: string;
}): Promise<string | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from("trips")
      .insert({
        cache_key: opts.cacheKey,
        answers: opts.answers,
        itinerary: opts.itinerary,
        destination_name: opts.destinationName,
      })
      .select("id")
      .single();

    if (error || !data) return null;
    return data.id as string;
  } catch {
    return null;
  }
}

export async function getTrip(id: string): Promise<StoredTrip | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from("trips")
      .select("id, itinerary, destination_name, created_at")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) return null;
    return {
      id: data.id as string,
      itinerary: data.itinerary as Itinerary,
      destinationName: data.destination_name as string,
      createdAt: data.created_at as string,
    };
  } catch {
    return null;
  }
}
