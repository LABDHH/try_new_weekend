import { NextRequest } from "next/server";
import { answersSchema } from "@/lib/schema/answers";
import { encodeEvent, type PlanEvent } from "@/lib/schema/events";
import { planTrip } from "@/lib/pipeline/orchestrate";
import { toPlannerError } from "@/lib/errors";
import { cacheKey, findCached, saveTrip } from "@/lib/store/supabase";

export const runtime = "nodejs";
// The pipeline runs 25-45s; Vercel's default function timeout is shorter.
export const maxDuration = 120;

/** Crude per-IP throttle. In-memory, so it resets on deploy — enough for an MVP. */
const recent = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear(); // crude bound on memory growth
  return hits.length > MAX_PER_WINDOW;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (rateLimited(ip)) {
    return Response.json(
      { error: "Too many requests. Give it a minute." },
      { status: 429 },
    );
  }

  // INPUT GUARDRAIL: nothing reaches the pipeline unvalidated.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = answersSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Those answers don't look right.",
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const answers = parsed.data;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (e: PlanEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(e)));
        } catch {
          closed = true;
        }
      };

      // A comment frame every 15s. Ignored by the client parser, but it keeps
      // intermediaries from treating a long quiet stage as a dead connection.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          closed = true;
        }
      }, 15_000);

      try {
        const key = cacheKey(answers);

        const cached = await findCached(key);
        if (cached) {
          send({ type: "stage", stage: "saving", message: "Found this one already planned..." });
          send({ type: "done", itinerary: cached.itinerary, tripId: cached.id });
          return;
        }

        send({ type: "stage", stage: "geocoding", message: "Getting your bearings..." });

        const { itinerary, destination, debug } = await planTrip(answers, send);

        send({ type: "stage", stage: "saving", message: "Saving your trip..." });
        const tripId = await saveTrip({
          cacheKey: key,
          answers,
          itinerary,
          destinationName: destination.name,
        });

        send({ type: "done", itinerary, tripId: tripId ?? undefined, debug });
      } catch (e) {
        const err = toPlannerError(e);
        // Server-side detail stays server-side; the client sees userMessage only.
        console.error("[plan] failed:", err.kind, err.message);
        send({ type: "error", kind: err.kind, message: err.userMessage });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
