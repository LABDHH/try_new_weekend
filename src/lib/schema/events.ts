import type { Itinerary } from "./itinerary";

/**
 * Progress events streamed to the browser.
 *
 * The pipeline runs 25-45s. Narrating the work turns dead spinner time into
 * visible evidence that real data is being gathered.
 */
export type PlanEvent =
  | { type: "stage"; stage: PlanStage; message: string }
  | { type: "destinations"; names: string[] }
  | { type: "chosen"; name: string; driveMinutes: number }
  | { type: "done"; itinerary: Itinerary; tripId?: string; debug?: unknown }
  | { type: "error"; message: string; kind: string };

export type PlanStage =
  | "geocoding"
  | "ideating"
  | "verifying"
  | "weather"
  | "places"
  | "shortlisting"
  | "enriching"
  | "composing"
  | "saving";

export const STAGE_ORDER: PlanStage[] = [
  "geocoding",
  "ideating",
  "verifying",
  "weather",
  "places",
  "shortlisting",
  "enriching",
  "composing",
  "saving",
];

export function encodeEvent(e: PlanEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}
