import type { FOCUS_TAGS } from "./schema/answers";

/**
 * Maps travel intent to its semantic accent.
 *
 * Intent is expressed through chips and badges only — never through recolouring
 * surfaces. A wellness weekend and a nightlife weekend share one neutral shell,
 * which keeps visual hierarchy stable and lets new intents be added without a
 * redesign.
 */
export const INTENT_COLOR: Record<keyof typeof FOCUS_TAGS, string> = {
  switch_off: "var(--color-intent-calm)",
  scenic: "var(--color-intent-calm)",
  nature: "var(--color-intent-adventure)",
  nightlife: "var(--color-intent-night)",
  rustic: "var(--color-intent-family)",
  luxe: "var(--color-intent-romance)",
  culture: "var(--color-intent-culture)",
  food: "var(--color-intent-food)",
  offbeat: "var(--color-intent-night)",
};

/** Stop kinds inherit the same semantics, so badges read consistently. */
export const KIND_COLOR: Record<string, string> = {
  breakfast: "var(--color-intent-food)",
  lunch: "var(--color-intent-food)",
  dinner: "var(--color-intent-food)",
  coffee: "var(--color-intent-food)",
  dessert: "var(--color-intent-food)",
  outdoor: "var(--color-intent-adventure)",
  activity: "var(--color-intent-adventure)",
  viewpoint: "var(--color-intent-calm)",
  sight: "var(--color-intent-culture)",
  evening: "var(--color-intent-night)",
  shopping: "var(--color-intent-family)",
  checkin: "var(--color-intent-romance)",
  depart: "var(--color-slate-500)",
  drive_home: "var(--color-slate-500)",
};
