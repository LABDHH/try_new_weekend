"use client";

import { useEffect, useState } from "react";

/* Shared input primitives for the question flow (dark forest surface). */

export function OptionButton({
  label,
  selected,
  onClick,
  disabled,
  note,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={[
        "group relative w-full overflow-hidden rounded-2xl border px-5 py-4 text-left transition-all duration-200",
        selected
          ? "border-amber-400/70 bg-amber-400/10 shadow-[0_0_0_1px_rgba(242,180,80,0.25)]"
          : "border-slate-400/15 bg-slate-800/40 hover:border-slate-400/40 hover:bg-slate-800/70",
        disabled ? "cursor-not-allowed opacity-30 hover:border-slate-400/15 hover:bg-slate-800/40" : "",
      ].join(" ")}
    >
      <span className="flex items-center justify-between gap-3">
        <span className={selected ? "font-sans text-[15px] text-slate-50" : "font-sans text-[15px] text-slate-300"}>
          {label}
        </span>
        <span
          className={[
            "h-2 w-2 shrink-0 rounded-full transition",
            selected ? "bg-amber-400" : "bg-slate-400/25 group-hover:bg-slate-400/50",
          ].join(" ")}
        />
      </span>
      {note && <span className="mt-1.5 block font-sans text-xs text-slate-400/70">{note}</span>}
    </button>
  );
}

/**
 * Intent chips carry their own semantic accent when selected.
 *
 * The shell stays neutral; only the chip signals what kind of trip this is.
 * That is what lets one UI serve a spa weekend and a nightlife weekend without
 * recolouring the whole page per intent.
 */
export function Chip({
  label,
  selected,
  onClick,
  disabled,
  accent,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      style={
        selected && accent
          ? { backgroundColor: accent, borderColor: accent, color: "#020617" }
          : accent
            ? { borderColor: `color-mix(in srgb, ${accent} 45%, transparent)` }
            : undefined
      }
      className={[
        "rounded-full border px-4 py-2.5 font-sans text-sm transition-all duration-200",
        selected
          ? "font-medium shadow-sm"
          : "bg-transparent text-slate-300 hover:bg-slate-800/60",
        disabled && !selected ? "cursor-not-allowed opacity-25" : "",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/** Multi-line free text, for answers that do not fit a chip. */
export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-none rounded-2xl border border-slate-700 bg-slate-900/60 p-4 font-sans text-base leading-relaxed text-slate-50 outline-none transition-colors placeholder:text-slate-500 focus:border-amber-500"
    />
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  autoFocus,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) onEnter();
      }}
      className="w-full border-b border-slate-400/30 bg-transparent pb-3 font-display text-3xl text-slate-50 outline-none transition-colors placeholder:text-slate-400/30 focus:border-amber-400"
    />
  );
}

export type CityChoice = { placeId: string; label: string };

/**
 * Origin city input, backed by the server-side autocomplete proxy.
 *
 * The city MUST be chosen from the returned list. Free text is not accepted,
 * because a place that Google cannot resolve cannot be routed to, weather-
 * checked, or searched around — and silently accepting one produces a
 * confusing failure much deeper in the pipeline.
 */
export function CityField({
  selected,
  onSelect,
}: {
  selected: CityChoice | null;
  onSelect: (c: CityChoice | null) => void;
}) {
  const [query, setQuery] = useState(selected?.label ?? "");
  const [suggestions, setSuggestions] = useState<
    { placeId: string; label: string; main: string; secondary: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();

    // Compare against the CONFIRMED selection, not against a value that the
    // parent mirrors back on every keystroke — that was the bug that silently
    // disabled autocomplete entirely.
    if (q.length < 2 || q === selected?.label) return;

    let cancelled = false;

    // Debounced: autocomplete is billed per request, and every keystroke is one.
    // The loading flag is set inside the timeout rather than in the effect body
    // — no synchronous setState cascade, and no spinner flicker while typing.
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (cancelled) return;
        setSuggestions(data.suggestions ?? []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setSearched(true);
        }
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected?.label]);

  const showList = query.trim().length >= 2 && query.trim() !== selected?.label;

  return (
    <div className="relative">
      <TextField
        value={query}
        onChange={(v) => {
          setQuery(v);
          setSearched(false);
          // Typing invalidates any previous confirmed choice.
          if (selected) onSelect(null);
        }}
        placeholder="Start typing a city"
        autoFocus
      />

      {selected && query.trim() === selected.label && (
        <p className="mt-3 flex items-center gap-2 font-sans text-xs text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Confirmed
        </p>
      )}

      {showList && (
        <div className="absolute z-20 mt-3 w-full overflow-hidden rounded-2xl border border-slate-400/20 bg-slate-900/95 shadow-2xl shadow-slate-950/60 backdrop-blur-xl">
          {loading && (
            <p className="px-5 py-4 font-sans text-sm text-slate-400/70">Searching...</p>
          )}

          {!loading && suggestions.length === 0 && searched && (
            <p className="px-5 py-4 font-sans text-sm text-slate-400/70">
              No cities match that. Check the spelling.
            </p>
          )}

          {!loading &&
            suggestions.map((s) => (
              <button
                key={s.placeId}
                type="button"
                onClick={() => {
                  setQuery(s.label);
                  setSuggestions([]);
                  onSelect({ placeId: s.placeId, label: s.label });
                }}
                className="flex w-full flex-col items-start gap-0.5 border-b border-slate-400/10 px-5 py-3.5 text-left transition last:border-0 hover:bg-slate-700/60"
              >
                <span className="font-sans text-[15px] text-slate-50">{s.main}</span>
                {s.secondary && (
                  <span className="font-sans text-xs text-slate-400/70">{s.secondary}</span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** datetime-local, rendered in the browser's timezone — i.e. the traveller's. */
export function DateTimeField({
  value,
  onChange,
  min,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
}) {
  return (
    <input
      type="datetime-local"
      value={value}
      min={min}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border-b border-slate-400/30 bg-transparent pb-3 font-display text-3xl text-slate-50 outline-none transition-colors [color-scheme:dark] focus:border-amber-400"
    />
  );
}
