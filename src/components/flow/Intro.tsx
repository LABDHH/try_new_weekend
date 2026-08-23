"use client";

import { motion } from "motion/react";
import { TAGLINE, Wordmark } from "@/components/Brand";

/**
 * Landing screen.
 *
 * One tap of friction, in exchange for the brand having somewhere to live and
 * the user knowing what they are about to do. The three-line "how it works"
 * also sets the expectation that this takes ~40 seconds and uses real data,
 * which makes the wait afterwards read as work rather than as lag.
 */
export function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="horizon flow-screen relative overflow-hidden">
      <div className="contours pointer-events-none absolute inset-0" />

      <div className="relative flex min-h-dvh flex-col justify-between px-6 py-10 sm:py-14">
        <Wordmark size="md" />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full max-w-3xl py-16"
        >
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-amber-500/70" />
            <p className="font-sans text-[10px] uppercase tracking-[0.28em] text-amber-500">
              Weekend road trips, properly planned
            </p>
          </div>

          <h1 className="mt-7 max-w-2xl font-display text-[2.6rem] leading-[1.06] text-slate-50 sm:text-[4.25rem]">
            Out of office.
            <br />
            Into your{" "}
            <span className="italic text-amber-500">NewWeekend</span>.
          </h1>

          <p className="mt-8 max-w-lg font-sans text-lg leading-relaxed text-slate-300">
            Tell us where you are and what you feel like. We check real traffic,
            real weather and what people actually say about a place — then build
            the weekend hour by hour.
          </p>

          <button
            type="button"
            onClick={onStart}
            className="group mt-11 rounded-full bg-amber-500 px-9 py-4 font-sans text-sm font-medium text-slate-950 transition-all duration-200 hover:bg-amber-400 hover:shadow-[0_10px_36px_-10px_rgba(245,158,11,0.7)]"
          >
            Plan my weekend
            <span className="ml-2 inline-block transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </button>
        </motion.div>

        <div className="grid gap-5 border-t border-slate-800 pt-7 sm:grid-cols-3">
          {[
            ["Eight questions", "About a minute. No account, no sign-up."],
            ["Real data", "Traffic-aware drive times, live forecasts, real reviews."],
            ["An actual plan", "Hour by hour, with backups when things change."],
          ].map(([title, body]) => (
            <div key={title}>
              <p className="font-sans text-[13px] font-medium text-slate-50">{title}</p>
              <p className="mt-1 font-sans text-[13px] leading-relaxed text-slate-400">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { TAGLINE };
