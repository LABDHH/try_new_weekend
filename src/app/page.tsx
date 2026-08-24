"use client";

import { useCallback, useState } from "react";
import { Intro } from "@/components/flow/Intro";
import { PlannerFlow, type DraftAnswers } from "@/components/flow/PlannerFlow";
import { PlanningScreen } from "@/components/flow/PlanningScreen";
import { ItineraryView } from "@/components/trip/Itinerary";
import type { PlanEvent } from "@/lib/schema/events";
import type { Itinerary } from "@/lib/schema/itinerary";

type Phase = "intro" | "questions" | "planning" | "done" | "error";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [messages, setMessages] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [chosen, setChosen] = useState<{ name: string; driveMinutes: number } | null>(null);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const submit = useCallback(async (draft: DraftAnswers) => {
    setPhase("planning");
    setMessages([]);
    setCandidates([]);
    setChosen(null);
    setError("");

    try {
      if (!draft.origin) throw new Error("Pick a starting city from the list.");

      // Resolve by placeId, not by re-geocoding the label: the id is an exact
      // match for what they picked and cannot drift to a same-named city.
      const geo = await fetch("/api/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: draft.origin.placeId }),
      });
      if (!geo.ok) throw new Error("We couldn't locate that starting city.");
      const origin = await geo.json();

      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: { name: origin.name, lat: origin.lat, lng: origin.lng },
          departAt: new Date(draft.departAt).toISOString(),
          returnBy: new Date(draft.returnBy).toISOString(),
          driveBucket: draft.driveBucket,
          who: draft.who,
          focus: draft.focus,
          focusText: draft.focusText,
          budgetLevel: draft.budgetLevel,
          freeText: draft.freeText,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // 429 is an expected, explainable state — not a crash. The server's
        // message already says whether it is a personal limit or a daily cap.
        throw new Error(body.error ?? "Something went wrong.");
      }
      if (!res.body) throw new Error("No response from the planner.");

      // Parse the SSE stream frame by frame.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Tracks whether the server ever sent a terminal event. If the function
      // is killed mid-stream (platform timeout, crash, dropped connection) the
      // read loop simply ends, and without this the UI waits forever.
      let terminated = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          let event: PlanEvent;
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (event.type === "done" || event.type === "error") terminated = true;
          handleEvent(event);
        }
      }

      if (!terminated) {
        throw new Error(
          "The connection dropped before your itinerary was finished. This usually means it took too long — try again, or pick a shorter drive time.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }

    function handleEvent(event: PlanEvent) {
      switch (event.type) {
        case "stage":
          setMessages((m) => (m[m.length - 1] === event.message ? m : [...m, event.message]));
          break;
        case "destinations":
          setCandidates(event.names);
          break;
        case "chosen":
          setChosen({ name: event.name, driveMinutes: event.driveMinutes });
          break;
        case "done":
          setItinerary(event.itinerary);
          setTripId(event.tripId ?? null);
          setPhase("done");
          break;
        case "error":
          setError(event.message);
          setPhase("error");
          break;
      }
    }
  }, []);

  if (phase === "intro") return <Intro onStart={() => setPhase("questions")} />;

  if (phase === "questions") return <PlannerFlow onSubmit={submit} />;

  if (phase === "planning")
    return <PlanningScreen messages={messages} candidates={candidates} chosen={chosen} />;

  if (phase === "error")
    return (
      <div className="horizon flow-screen relative flex flex-col items-center justify-center gap-6 overflow-hidden px-6 text-center">
        <div className="contours pointer-events-none absolute inset-0" />
        <p className="relative font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--color-intent-adventure)]">
          Didn&apos;t work
        </p>
        <h2 className="relative max-w-lg font-display text-4xl leading-tight text-slate-50">
          {error}
        </h2>
        <button
          type="button"
          onClick={() => setPhase("questions")}
          className="relative mt-2 rounded-full bg-amber-400 px-8 py-3.5 font-sans text-sm font-medium text-slate-950 transition hover:bg-amber-300"
        >
          Start over
        </button>
      </div>
    );

  return (
    <>
      {itinerary && <ItineraryView itinerary={itinerary} />}
      <div className="bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-6 pb-24">
          <button
            type="button"
            onClick={() => {
              setPhase("questions");
              setItinerary(null);
            }}
            className="rounded-full border border-slate-300 px-6 py-2.5 font-sans text-sm text-secondary transition hover:border-border-strong hover:bg-slate-100"
          >
            Plan another
          </button>
          {tripId && (
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/trip/${tripId}`)}
              className="rounded-full bg-slate-900 px-6 py-2.5 font-sans text-sm text-slate-50 transition hover:bg-slate-700"
            >
              Copy share link
            </button>
          )}
        </div>
      </div>
    </>
  );
}
