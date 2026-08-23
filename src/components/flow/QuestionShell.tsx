"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * One question per screen, full bleed, on the dark forest surface.
 *
 * Horizontal motion is deliberate: this is a travel product, and sliding
 * forward reads as progress in a way a fade does not. Direction reverses on
 * back-navigation so the gesture stays spatially coherent.
 */
export function QuestionShell({
  stepKey,
  direction,
  eyebrow,
  question,
  hint,
  children,
  onNext,
  onBack,
  canAdvance,
  nextLabel = "Continue",
  isLast,
}: {
  stepKey: string;
  direction: 1 | -1;
  eyebrow: string;
  question: string;
  hint?: string;
  children: ReactNode;
  onNext: () => void;
  onBack?: () => void;
  canAdvance: boolean;
  nextLabel?: string;
  isLast?: boolean;
}) {
  return (
    <div className="horizon flow-screen relative overflow-hidden">
      <div className="contours pointer-events-none absolute inset-0" />

      <div className="relative flex min-h-dvh items-center justify-center px-6 py-28">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={stepKey}
            initial={{ opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -40 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-2xl"
          >
            <div className="flex items-center gap-3">
              <span className="h-px w-8 bg-amber-400/60" />
              <p className="font-sans text-[10px] uppercase tracking-[0.28em] text-amber-400">
                {eyebrow}
              </p>
            </div>

            <h2 className="mt-6 font-display text-[2.75rem] leading-[1.05] text-slate-50 sm:text-6xl">
              {question}
            </h2>

            {hint && (
              <p className="mt-4 max-w-lg font-sans text-sm leading-relaxed text-slate-400">
                {hint}
              </p>
            )}

            <div className="mt-12">{children}</div>

            <div className="mt-12 flex items-center gap-6">
              <button
                type="button"
                onClick={onNext}
                disabled={!canAdvance}
                className="group relative rounded-full bg-amber-400 px-8 py-3.5 font-sans text-sm font-medium text-slate-950 transition-all duration-200 enabled:hover:bg-amber-300 enabled:hover:shadow-[0_8px_30px_-8px_rgba(242,180,80,0.6)] disabled:cursor-not-allowed disabled:bg-slate-400/15 disabled:text-slate-400/50"
              >
                {isLast ? "Plan my trip" : nextLabel}
                <span className="ml-2 inline-block transition-transform group-enabled:group-hover:translate-x-0.5">
                  →
                </span>
              </button>

              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="font-sans text-sm text-slate-400/70 underline-offset-4 transition hover:text-slate-50 hover:underline"
                >
                  Back
                </button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
