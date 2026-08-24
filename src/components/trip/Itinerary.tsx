"use client";

import { useState } from "react";
import type { Itinerary, ItineraryStop } from "@/lib/schema/itinerary";
import { KIND_COLOR } from "@/lib/intent";
import { TAGLINE, Wordmark } from "@/components/Brand";

const KIND: Record<ItineraryStop["kind"], { label: string; glyph: string }> = {
  depart: { label: "Set off", glyph: "→" },
  checkin: { label: "Check in", glyph: "⌂" },
  breakfast: { label: "Breakfast", glyph: "◔" },
  coffee: { label: "Coffee", glyph: "◉" },
  sight: { label: "See", glyph: "◇" },
  outdoor: { label: "Outdoors", glyph: "▲" },
  lunch: { label: "Lunch", glyph: "◑" },
  activity: { label: "Do", glyph: "✦" },
  viewpoint: { label: "Viewpoint", glyph: "◬" },
  shopping: { label: "Browse", glyph: "◈" },
  dinner: { label: "Dinner", glyph: "◕" },
  evening: { label: "Evening", glyph: "☾" },
  dessert: { label: "Dessert", glyph: "◐" },
  drive_home: { label: "Drive home", glyph: "←" },
};

const dayName = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

/**
 * Vertical timeline with a time gutter, not a grid of cards.
 * It should read like a day plan someone wrote, not a search results page.
 */
export function ItineraryView({ itinerary }: { itinerary: Itinerary }) {
  return (
    <div className="bg-surface min-h-dvh text-primary">
      {/* Dark masthead carries the forest identity across from the question flow */}
      <header className="horizon relative overflow-hidden">
        <div className="contours pointer-events-none absolute inset-0" />
        <div className="relative mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-amber-400/60" />
            <p className="font-sans text-[10px] uppercase tracking-[0.28em] text-amber-400">
              Your weekend
            </p>
          </div>

          <h1 className="mt-6 font-display text-5xl leading-[1.02] text-slate-50 sm:text-7xl">
            {itinerary.destinationName}
          </h1>

          <p className="mt-7 max-w-xl font-sans text-lg leading-relaxed text-slate-300">
            {itinerary.whyHere}
          </p>

          <div className="mt-8 rounded-2xl border border-slate-400/20 bg-slate-800/40 p-5 backdrop-blur">
            <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-amber-400">
              Known for
            </p>
            <p className="mt-2 font-sans text-sm leading-relaxed text-slate-300">
              {itinerary.knownFor}
            </p>
          </div>

          {itinerary.travelNote && (
            <p className="mt-6 border-l-2 border-amber-400/60 pl-4 font-sans text-sm leading-relaxed text-slate-400">
              {itinerary.travelNote}
            </p>
          )}
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <div className="space-y-20">
          {itinerary.days.map((day, i) => (
            <section key={day.date}>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-display text-5xl italic text-slate-300">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2 className="font-display text-3xl leading-tight text-primary">{day.title}</h2>
                  <p className="mt-1 font-sans text-xs uppercase tracking-[0.16em] text-muted">
                    {dayName(day.date)}
                  </p>
                </div>
              </div>

              <p className="mt-5 max-w-prose font-sans text-[15px] leading-relaxed text-secondary">
                {day.narrative}
              </p>

              {day.weatherNote && (
                <p className="mt-4 inline-flex rounded-full bg-slate-200/70 px-4 py-2 font-sans text-xs text-secondary">
                  {day.weatherNote}
                </p>
              )}

              <ol className="mt-10 space-y-0">
                {day.stops.map((stop, si) => (
                  <Stop
                    key={`${day.date}-${stop.placeId}-${si}`}
                    stop={stop}
                    isLast={si === day.stops.length - 1}
                  />
                ))}
              </ol>

              {day.alternates.length > 0 && (
                <div className="mt-10 rounded-2xl border border-slate-300/60 bg-slate-100/60 p-6">
                  <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-muted">
                    If plans change
                  </p>
                  <ul className="mt-4 space-y-4">
                    {day.alternates.map((alt) => (
                      <li key={alt.placeId}>
                        <p className="font-sans text-sm font-medium text-primary">{alt.name}</p>
                        <p className="mt-0.5 font-sans text-xs text-muted">
                          instead of {alt.insteadOf}
                        </p>
                        <p className="mt-1.5 font-sans text-sm leading-relaxed text-secondary">
                          {alt.why}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ))}
        </div>

        {itinerary.beforeYouGo.length > 0 && (
          <section className="mt-20 rounded-3xl bg-slate-900 p-8 text-slate-50">
            <h3 className="font-display text-2xl">Before you go</h3>
            <ul className="mt-5 space-y-3">
              {itinerary.beforeYouGo.map((b, i) => (
                <li key={i} className="flex gap-3 font-sans text-sm leading-relaxed text-slate-300">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                  {b}
                </li>
              ))}
            </ul>
          </section>
        )}

        {itinerary.caveats.length > 0 && (
          <section className="mt-8 rounded-3xl border border-slate-300/70 p-8">
            <h3 className="font-sans text-[10px] uppercase tracking-[0.2em] text-muted">
              Worth knowing
            </h3>
            <ul className="mt-4 space-y-3">
              {itinerary.caveats.map((c, i) => (
                <li key={i} className="font-sans text-sm leading-relaxed text-secondary">
                  {c}
                </li>
              ))}
            </ul>
          </section>
        )}
        <footer className="mt-20 border-t border-border-subtle pt-8">
          <Wordmark size="sm" onDark={false} />
          <p className="mt-2 font-sans text-sm text-muted">{TAGLINE}</p>
        </footer>
      </article>
    </div>
  );
}

function Stop({ stop, isLast }: { stop: ItineraryStop; isLast: boolean }) {
  // Plan first, reasoning on demand: the itinerary is the product, the
  // justification is the receipt.
  const [showWhy, setShowWhy] = useState(false);
  const kind = KIND[stop.kind];
  const accent = KIND_COLOR[stop.kind] ?? "var(--color-slate-500)";

  return (
    <li className="grid grid-cols-[54px_28px_1fr] gap-x-3 sm:grid-cols-[68px_32px_1fr] sm:gap-x-4">
      {/* Time gutter */}
      <div className="pt-1 text-right">
        <p className="tnum font-sans text-sm text-primary">{stop.startTime}</p>
        <p className="tnum font-sans text-[11px] text-muted">{stop.endTime}</p>
      </div>

      {/* Spine */}
      <div className="flex flex-col items-center">
        <span
          style={
            stop.isHighlight
              ? undefined
              : { borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`, color: accent }
          }
          className={[
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px]",
            stop.isHighlight
              ? "bg-amber-500 text-slate-950"
              : "border bg-surface-raised",
          ].join(" ")}
        >
          {kind.glyph}
        </span>
        {!isLast && <span className="w-px flex-1 bg-border-subtle" />}
      </div>

      <div className={`pb-10 ${stop.optional ? "opacity-75" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span
            style={{ color: accent }}
            className="font-sans text-[10px] font-medium uppercase tracking-[0.18em]"
          >
            {kind.label}
          </span>
          {stop.isHighlight && (
            <span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-sans text-[10px] uppercase tracking-[0.14em] text-amber-600">
              Highlight
            </span>
          )}
          {stop.optional && (
            <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">
              Optional
            </span>
          )}
        </div>

        <h3 className="mt-1.5 font-display text-2xl leading-tight text-primary">{stop.name}</h3>

        <p className="mt-2 max-w-prose font-sans text-[15px] leading-relaxed text-secondary">
          {stop.famousFor}
        </p>

        {stop.headsUp && (
          <p className="mt-3 inline-flex items-start gap-2 rounded-lg bg-[color:var(--color-intent-adventure)]/10 px-3 py-2 font-sans text-[13px] leading-relaxed text-[color:var(--color-intent-adventure)]">
            <span className="mt-px">!</span>
            {stop.headsUp}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-4">
          {stop.travelFromPrevious && (
            <span className="font-sans text-xs text-muted">{stop.travelFromPrevious}</span>
          )}
          <button
            type="button"
            onClick={() => setShowWhy((v) => !v)}
            className="font-sans text-xs text-muted underline underline-offset-4 transition hover:text-primary"
          >
            {showWhy ? "Hide" : "More about this"}
          </button>
        </div>

        {showWhy && (
          <p className="mt-3 max-w-prose border-l-2 border-amber-400/50 py-1 pl-4 font-sans text-sm leading-relaxed text-secondary">
            {stop.detail ?? (stop as { why?: string }).why}
          </p>
        )}
      </div>
    </li>
  );
}
