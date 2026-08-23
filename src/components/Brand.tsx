"use client";

/**
 * Wordmark.
 *
 * "New" sits in the neutral shell colour and "Weekend" carries the amber
 * accent — the brand is the moment the ordinary week turns into the weekend,
 * so the colour break falls exactly on that word.
 */
export function Wordmark({
  size = "md",
  onDark = true,
}: {
  size?: "sm" | "md" | "lg";
  onDark?: boolean;
}) {
  const scale = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-5xl sm:text-6xl",
  }[size];

  return (
    <span className={`font-display ${scale} leading-none tracking-tight`}>
      <span className={onDark ? "text-slate-50" : "text-primary"}>New</span>
      <span className="italic text-amber-500">Weekend</span>
    </span>
  );
}

export const TAGLINE = "Out of office. Into your NewWeekend.";
