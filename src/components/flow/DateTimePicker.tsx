"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * Custom date + time picker.
 *
 * Native inputs were the problem, not the styling: Chrome renders a rich
 * dropdown, Safari renders a stepper you type into, and neither can be themed.
 * Owning the control means one consistent, styleable UI everywhere — and it
 * lets the calendar do things that matter for THIS product, like marking
 * weekends and offering "this weekend" as one tap.
 *
 * Value format is unchanged: "YYYY-MM-DDTHH:mm" in the traveller's local time.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  const minute = i % 2 === 0 ? "00" : "30";
  const value = `${String(hour).padStart(2, "0")}:${minute}`;
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return { value, label: `${display}:${minute} ${suffix}` };
});

const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Parse a date key without letting the timezone shift the day. */
function fromKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Monday-first grid, so Saturday and Sunday sit together at the end. */
function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function formatDisplay(dateKey: string, time: string): string {
  const d = fromKey(dateKey);
  if (!d) return "Pick a date";
  const slot = TIME_SLOTS.find((s) => s.value === time);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${weekday}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} · ${slot?.label ?? time}`;
}

export function DateTimePicker({
  value,
  onChange,
  min,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  label?: string;
}) {
  const [dateKey = "", time = "09:00"] = value.split("T");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeListRef = useRef<HTMLDivElement>(null);

  const selected = fromKey(dateKey);
  const minDate = min ? fromKey(min.split("T")[0]) : null;

  const [viewYear, setViewYear] = useState(() => (selected ?? new Date()).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selected ?? new Date()).getMonth());

  const cells = useMemo(() => monthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const todayKey = toKey(new Date());

  // Close on outside click or Escape — expected behaviour for any popover.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Bring the chosen time into view instead of making people scroll to find it.
  useEffect(() => {
    if (!open) return;
    const el = timeListRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView({ block: "center" });
  }, [open]);

  const isDisabled = (d: Date) => {
    if (!minDate) return false;
    return toKey(d) < toKey(minDate);
  };

  const pickDate = (d: Date) => {
    onChange(`${toKey(d)}T${time}`);
  };

  const pickTime = (t: string) => {
    onChange(`${dateKey || todayKey}T${t}`);
    setOpen(false);
  };

  /** Weekend shortcuts — the whole product is about weekends. */
  const shortcuts = useMemo(() => {
    const now = new Date();
    const thisSat = new Date(now);
    thisSat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
    const nextSat = new Date(thisSat);
    nextSat.setDate(thisSat.getDate() + 7);
    return [
      { label: "This Saturday", date: thisSat },
      { label: "Next Saturday", date: nextSat },
    ];
  }, []);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label ?? "Choose date and time"}
        className={[
          "flex w-full items-center justify-between gap-4 rounded-2xl border px-5 py-4 text-left transition-all",
          open
            ? "border-amber-500 bg-slate-900/80"
            : "border-slate-700 bg-slate-900/60 hover:border-slate-500",
        ].join(" ")}
      >
        <span className="font-display text-2xl text-slate-50 sm:text-3xl">
          {formatDisplay(dateKey, time)}
        </span>
        <span className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
            className="absolute z-40 mt-3 w-full overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60"
          >
            <div className="flex flex-col sm:flex-row">
              {/* Calendar */}
              <div className="flex-1 border-slate-800 p-5 sm:border-r">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => shiftMonth(-1)}
                    aria-label="Previous month"
                    className="rounded-lg px-2.5 py-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-50"
                  >
                    ←
                  </button>
                  <span className="font-sans text-sm font-medium text-slate-50">
                    {MONTHS[viewMonth]} {viewYear}
                  </span>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    aria-label="Next month"
                    className="rounded-lg px-2.5 py-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-50"
                  >
                    →
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-7 gap-1">
                  {WEEKDAYS.map((w) => (
                    <span
                      key={w}
                      className="pb-1 text-center font-sans text-[10px] uppercase tracking-wider text-slate-500"
                    >
                      {w.slice(0, 1)}
                    </span>
                  ))}

                  {cells.map((d, i) => {
                    if (!d) return <span key={`empty-${i}`} />;
                    const key = toKey(d);
                    const isSelected = key === dateKey;
                    const isToday = key === todayKey;
                    const disabled = isDisabled(d);
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={disabled}
                        onClick={() => pickDate(d)}
                        className={[
                          "relative aspect-square rounded-lg font-sans text-[13px] transition",
                          isSelected
                            ? "bg-amber-500 font-medium text-slate-950"
                            : disabled
                              ? "cursor-not-allowed text-slate-700"
                              : isWeekend
                                ? "text-amber-300/90 hover:bg-slate-800"
                                : "text-slate-300 hover:bg-slate-800",
                        ].join(" ")}
                      >
                        {d.getDate()}
                        {isToday && !isSelected && (
                          <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-amber-500" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
                  {shortcuts.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => {
                        setViewYear(s.date.getFullYear());
                        setViewMonth(s.date.getMonth());
                        pickDate(s.date);
                      }}
                      className="rounded-full border border-slate-700 px-3 py-1.5 font-sans text-xs text-slate-300 transition hover:border-amber-500 hover:text-amber-300"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time */}
              <div className="sm:w-44">
                <p className="border-b border-slate-800 px-5 py-3 font-sans text-[10px] uppercase tracking-[0.18em] text-slate-500 sm:px-4">
                  Time
                </p>
                <div
                  ref={timeListRef}
                  className="max-h-56 overflow-y-auto p-2 sm:max-h-72"
                >
                  {TIME_SLOTS.map((slot) => {
                    const isSelected = slot.value === time;
                    return (
                      <button
                        key={slot.value}
                        type="button"
                        data-selected={isSelected}
                        onClick={() => pickTime(slot.value)}
                        className={[
                          "w-full rounded-lg px-3 py-2 text-left font-sans text-sm transition",
                          isSelected
                            ? "bg-amber-500 font-medium text-slate-950"
                            : "text-slate-300 hover:bg-slate-800",
                        ].join(" ")}
                      >
                        {slot.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
