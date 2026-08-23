import { z } from "zod";
import type { PlaceCategory } from "../config";

/** A place after hygiene, before review enrichment. */
export const poolPlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  category: z.string(),
  primaryType: z.string().optional(),
  types: z.array(z.string()).default([]),
  rating: z.number().optional(),
  ratingCount: z.number().optional(),
  priceLevel: z.string().optional(),
  openingHours: z.array(z.string()).default([]),
  mapsUri: z.string().optional(),
  websiteUri: z.string().optional(),
  /** Set by hygiene when ratingCount is too low to be trustworthy on its own. */
  sparseData: z.boolean().default(false),
});

export type PoolPlace = z.infer<typeof poolPlaceSchema> & { category: PlaceCategory };

/** Review data, fetched only for shortlisted finalists. */
export type PlaceEnrichment = {
  id: string;
  reviewSummary?: string;
  reviewSummaryUri?: string;
  editorialSummary?: string;
  reviews: string[];
};

export type EnrichedPlace = PoolPlace & Partial<Omit<PlaceEnrichment, "id">>;

export type Destination = {
  name: string;
  region?: string;
  lat: number;
  lng: number;
  /** Why Gemini proposed it — carried through for the final "why here" line. */
  pitch?: string;
  /** Distinct kinds of thing to do there, from ideation. Feeds the balance check. */
  offers?: string[];
  /** Whether this month actually works there. */
  seasonNote?: string;
  /** How it matches what this traveller asked for. */
  matchesInterests?: string;
  driveSeconds?: number;
  driveMeters?: number;
  returnSeconds?: number;
};

export type DayWeather = {
  date: string;
  summary: string;
  maxC?: number;
  minC?: number;
  precipitationPercent?: number;
  /** False when the date is past the 10-day forecast horizon. */
  available: boolean;
};
