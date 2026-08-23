import { z } from "zod";

/**
 * SERVER ONLY — never import this from a client component.
 *
 * Client-safe constants live in limits.ts precisely so that importing them
 * does not drag the env schema into the browser bundle. `npm run check:bundle`
 * fails the build if anything from here reaches the client.
 *
 * Env is validated once, at first access, and fails loudly with a readable
 * message. A missing key should surface as "GOOGLE_MAPS_API_KEY is required",
 * not as a 403 from Google three layers deep in the pipeline.
 */
const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  GOOGLE_MAPS_API_KEY: z.string().min(1, "GOOGLE_MAPS_API_KEY is required"),

  // Pinned rather than a rolling alias: `gemini-flash-latest` can change model
  // behaviour underneath prompts that were tuned against a specific version.
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),

  // Supabase is Phase 5 and entirely optional. Blank => persistence disabled,
  // itineraries are returned inline instead of via a share link.
  SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().or(z.literal("")),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${detail}\n\n` +
        `Copy .env.example to .env.local and fill in the keys.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/**
 * Read directly from process.env rather than through env(): Supabase is
 * optional, so asking "is it configured?" must not fail merely because an
 * unrelated key (Gemini, Maps) is missing.
 */
export function supabaseEnabled(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function supabaseCredentials(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}


// Re-exported so server code has a single import site.
export * from "./limits";
