"use client";

import { AnimatePresence, motion } from "motion/react";

/**
 * The pipeline takes 25-45 seconds. A silent spinner that long reads as broken,
 * so the stages narrate themselves as they complete. Showing the work is also
 * honest: each line is real data actually being fetched.
 */
export function PlanningScreen({
  messages,
  candidates,
  chosen,
}: {
  messages: string[];
  candidates: string[];
  chosen: { name: string; driveMinutes: number } | null;
}) {
  const current = messages[messages.length - 1] ?? "Starting...";

  return (
    <div className="horizon flow-screen relative overflow-hidden">
      <div className="contours pointer-events-none absolute inset-0" />

      <div className="relative flex min-h-dvh items-center justify-center px-6 py-24">
        <div className="w-full max-w-xl">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            <p className="font-sans text-[10px] uppercase tracking-[0.28em] text-amber-400">
              Planning
            </p>
          </div>

          <AnimatePresence mode="wait">
            <motion.h2
              key={current}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.3 }}
              className="mt-6 font-display text-4xl leading-[1.08] text-slate-50 sm:text-5xl"
            >
              {current}
            </motion.h2>
          </AnimatePresence>

          {candidates.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-10">
              <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-slate-400/70">
                Checking
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {candidates.map((c) => (
                  <li
                    key={c}
                    className={[
                      "rounded-full border px-3.5 py-1.5 font-sans text-xs transition-all duration-300",
                      chosen?.name === c
                        ? "border-amber-400 bg-amber-400 text-slate-950"
                        : "border-slate-400/25 text-slate-400",
                    ].join(" ")}
                  >
                    {c}
                  </li>
                ))}
              </ul>
            </motion.div>
          )}

          {chosen && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-6 font-sans text-sm text-slate-300"
            >
              {chosen.name} — about {chosen.driveMinutes} minutes each way in real traffic.
            </motion.p>
          )}

          <ul className="mt-12 space-y-2">
            {messages.slice(0, -1).map((m, i) => (
              <li key={`${m}-${i}`} className="flex items-start gap-2.5 font-sans text-xs text-slate-400/60">
                <span className="mt-1 text-amber-400/70">✓</span>
                {m}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
