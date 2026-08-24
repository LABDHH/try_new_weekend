/**
 * Abuse and cost protection.
 *
 * Serverless functions share no memory: each invocation may land on a fresh
 * instance, so an in-process counter cannot enforce anything. Real limiting
 * needs shared state, which is what Upstash provides over plain HTTP (no
 * connection pooling, which is why it suits serverless).
 *
 * Two distinct jobs, deliberately separated:
 *
 *   PER-IP     stops one person hammering the endpoint.
 *   DAILY CAP  bounds total spend regardless of how many people show up.
 *              This is the one that matters — a hundred well-behaved visitors
 *              cost exactly as much as one attacker sending a hundred requests.
 *
 * Without Upstash configured, both degrade to in-memory: better than nothing
 * on a single warm instance, but it must not be mistaken for real protection.
 */

import type { NextRequest } from "next/server";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * Client IP, as reported by Vercel's proxy.
 *
 * x-forwarded-for is client-controllable in principle, but on Vercel the
 * left-most entry is set by the platform edge, not the caller. Good enough for
 * throttling; the DAILY CAP is what actually bounds cost, and that cannot be
 * spoofed by rotating IPs.
 */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export const RATE_LIMITS = {
  /** Plans one IP may start per window. */
  PER_IP: Number(process.env.RATE_LIMIT_PER_IP ?? 3),
  PER_IP_WINDOW_SECONDS: 600,
  /** Total plans served per day, across everyone. The real cost ceiling. */
  DAILY_CAP: Number(process.env.DAILY_PLAN_CAP ?? 60),
} as const;

/**
 * Autocomplete has no per-plan cost ceiling to hide behind — it fires on every
 * keystroke, before a user has committed to anything, and is the first thing a
 * script hitting the site cold would find. 280ms debounce means a real person
 * typing a full city name fires maybe 3-6 requests; 20/min gives headroom for
 * that plus retyping, while still shutting down a scripted loop fast.
 */
export const AUTOCOMPLETE_LIMITS = {
  PER_IP: Number(process.env.RATE_LIMIT_AUTOCOMPLETE_PER_IP ?? 20),
  WINDOW_SECONDS: 60,
} as const;

export function sharedStoreConfigured(): boolean {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

/** Upstash REST pipeline. Returns null on any failure — never blocks on an outage. */
async function redis(commands: string[][]): Promise<unknown[] | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    return data.map((d) => d.result);
  } catch {
    // A rate-limiter outage must never take the app down with it.
    return null;
  }
}

/** In-memory fallback. Per-instance only — honest, but weak. */
const localCounters = new Map<string, { count: number; resetAt: number }>();

function localIncrement(key: string, windowSeconds: number): number {
  const now = Date.now();
  const existing = localCounters.get(key);
  if (!existing || now > existing.resetAt) {
    localCounters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return 1;
  }
  existing.count += 1;
  if (localCounters.size > 10_000) localCounters.clear();
  return existing.count;
}

async function increment(key: string, windowSeconds: number): Promise<number> {
  const result = await redis([
    ["INCR", key],
    ["EXPIRE", key, String(windowSeconds), "NX"],
  ]);
  if (result && typeof result[0] === "number") return result[0];
  return localIncrement(key, windowSeconds);
}

export type LimitVerdict =
  | { allowed: true }
  | { allowed: false; reason: "per_ip" | "daily_cap"; message: string; retryAfterSeconds: number };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Checked before any paid work happens.
 *
 * The daily cap is evaluated first: when the app is at capacity, everyone gets
 * the same honest answer rather than it depending on who asked recently.
 */
export async function checkLimits(ip: string): Promise<LimitVerdict> {
  const dayCount = await increment(`plans:day:${todayKey()}`, 86_400);
  if (dayCount > RATE_LIMITS.DAILY_CAP) {
    const secondsLeft = Math.max(60, 86_400 - Math.floor((Date.now() % 86_400_000) / 1000));
    return {
      allowed: false,
      reason: "daily_cap",
      message:
        "We've hit today's planning limit — this runs on a free API tier with a daily budget. Try again tomorrow.",
      retryAfterSeconds: secondsLeft,
    };
  }

  const ipCount = await increment(
    `plans:ip:${ip}:${Math.floor(Date.now() / (RATE_LIMITS.PER_IP_WINDOW_SECONDS * 1000))}`,
    RATE_LIMITS.PER_IP_WINDOW_SECONDS,
  );
  if (ipCount > RATE_LIMITS.PER_IP) {
    return {
      allowed: false,
      reason: "per_ip",
      message: `You've planned ${RATE_LIMITS.PER_IP} trips recently. Give it a few minutes before the next one.`,
      retryAfterSeconds: RATE_LIMITS.PER_IP_WINDOW_SECONDS,
    };
  }

  return { allowed: true };
}

/**
 * Autocomplete's own gate — no daily cap, since Essentials-tier lookups are
 * cheap enough that the plan-level DAILY_CAP is the real cost ceiling. This
 * exists to stop a script from hammering the endpoint directly, not to bound
 * spend.
 */
export async function checkAutocompleteLimit(ip: string): Promise<LimitVerdict> {
  const count = await increment(
    `autocomplete:ip:${ip}:${Math.floor(Date.now() / (AUTOCOMPLETE_LIMITS.WINDOW_SECONDS * 1000))}`,
    AUTOCOMPLETE_LIMITS.WINDOW_SECONDS,
  );
  if (count > AUTOCOMPLETE_LIMITS.PER_IP) {
    return {
      allowed: false,
      reason: "per_ip",
      message: "Too many location searches — slow down a moment.",
      retryAfterSeconds: AUTOCOMPLETE_LIMITS.WINDOW_SECONDS,
    };
  }
  return { allowed: true };
}

/** Only counts completed plans, so failures don't consume the day's budget. */
export async function recordCompletion(): Promise<void> {
  await redis([["INCR", `plans:completed:${todayKey()}`], ["EXPIRE", `plans:completed:${todayKey()}`, "604800", "NX"]]);
}
