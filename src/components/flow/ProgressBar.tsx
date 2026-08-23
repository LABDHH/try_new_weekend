"use client";

import { Wordmark } from "@/components/Brand";

export function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round(((current + 1) / total) * 100);
  return (
    <div className="fixed inset-x-0 top-0 z-30 px-6 pt-7">
      <div className="mx-auto flex max-w-2xl items-center gap-4">
        <Wordmark size="sm" />
        <div className="h-px flex-1 overflow-hidden bg-slate-400/15">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-amber-300 transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="tnum font-sans text-[11px] tracking-widest text-slate-400/70">
          {String(current + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
