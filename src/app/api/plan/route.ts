import { NextRequest } from "next/server";
import { answersSchema } from "@/lib/schema/answers";
import { encodeEvent, type PlanEvent } from "@/lib/schema/events";
import { planTrip } from "@/lib/pipeline/orchestrate";
import { toPlannerError } from "@/lib/errors";
import { cacheKey, findCached, saveTrip } from "@/lib/store/supabase";
import { checkLimits, clientIp, recordCompletion, sharedStoreConfigured } from "@/lib/ratelimit";

export const runtime = "nodejs";
// The pipeline runs 25-45s; Vercel's default function timeout is shorter.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  // Checked BEFORE validation and before any paid call. A blocked request
  // should cost a function invocation and nothing else.
  const verdict = await checkLimits(ip);
  if (!verdict.allowed) {
    if (!sharedStoreConfigured()) {
      console.warn(
        "[plan] rate limit hit, but no shared store is configured — limits are per-instance only and will not hold under real traffic.",
      );
    }
    return Response.json(
      { error: verdict.message, reason: verdict.reason },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
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

        await recordCompletion();
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
