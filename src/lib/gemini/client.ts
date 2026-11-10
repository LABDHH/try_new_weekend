import { GoogleGenAI, type ThinkingLevel } from "@google/genai";
import type { z } from "zod";
import type { Budget } from "../budget";
import { BUDGET, env } from "../config";
import { ModelOutputError, PlannerError, toPlannerError } from "../errors";
import { toGeminiSchema } from "../schema/itinerary";

let client: GoogleGenAI | null = null;

/** Models that rejected the configured thinking level; remembered per instance. */
const thinkingUnsupported = new Set<string>();

/** Compose may run on a stronger model than the cheaper upstream stages. */
function modelForStage(stage: string): string {
  const e = env();
  if (stage === "compose" && e.GEMINI_MODEL_COMPOSE) return e.GEMINI_MODEL_COMPOSE;
  return e.GEMINI_MODEL;
}

function thinkingForStage(stage: string): { thinkingLevel: ThinkingLevel } | undefined {
  const e = env();
  const level = stage === "compose" && e.GEMINI_THINKING_COMPOSE ? e.GEMINI_THINKING_COMPOSE : e.GEMINI_THINKING;
  return level === "default" ? undefined : { thinkingLevel: level as ThinkingLevel };
}

function ai(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: env().GEMINI_API_KEY });
  return client;
}

export type GenerateOptions<T> = {
  stage: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  budget: Budget;
  temperature?: number;
  /**
   * Repairs cosmetic/structural slips before validation runs. Lets a model
   * mistake that has an obvious correct answer be fixed for free instead of
   * consuming a repair round.
   */
  normalize?: (raw: unknown) => unknown;
  /**
   * Extra semantic checks beyond shape.
   *
   * Return a plain array to treat every issue as fatal, or split them:
   *   hard — the output is unusable (invented places, wrong dates). Never accept.
   *   soft — the output is usable but imperfect (balance, pacing). Worth a
   *          repair attempt, but NOT worth failing the whole request over.
   *
   * The distinction matters because a user who waited 60 seconds should get an
   * imperfect itinerary, not an error. Perfection here is the enemy of shipping
   * anything at all.
   */
  verify?: (value: T) => string[] | { hard?: string[]; soft?: string[] };
};

/**
 * OUTPUT GUARDRAIL.
 *
 * Structured output constrains generation, but the docs are explicit that it
 * guarantees syntax, not semantics — output can be schema-valid and still
 * wrong. So every response runs a three-layer gate:
 *
 *   1. JSON parse
 *   2. Zod shape validation
 *   3. caller-supplied semantic verification
 *
 * Failures feed the specific errors back for a repair attempt, bounded by the
 * request budget. A model that fails twice will not succeed on the fifth try,
 * and each attempt costs a full request.
 */
export async function generateStructured<T>(opts: GenerateOptions<T>): Promise<T> {
  const { stage, system, prompt, schema, budget, verify, normalize } = opts;
  const responseSchema = toGeminiSchema(schema);

  let currentPrompt = prompt;
  let lastIssues: string[] = [];
  // Survives across attempts: a later repair can come back worse, and an
  // imperfect earlier draft beats an error when time runs out.
  let softFallback: T | null = null;

  for (;;) {
    budget.chargeGemini(stage);

    let raw: string;
    const model = modelForStage(stage);
    const thinkingConfig = thinkingForStage(stage);
    const t0 = Date.now();
    try {
      raw = await callWithTransientRetry(async () => {
        const request = (withThinking: boolean) =>
          ai().models.generateContent({
            model,
            contents: currentPrompt,
            config: {
              systemInstruction: system,
              responseMimeType: "application/json",
              responseSchema,
              temperature: opts.temperature ?? 0.7,
              maxOutputTokens: BUDGET.MAX_OUTPUT_TOKENS,
              ...(withThinking && thinkingConfig ? { thinkingConfig } : {}),
            },
          });
        let usedThinking = Boolean(thinkingConfig) && !thinkingUnsupported.has(model);
        let res;
        try {
          res = await request(usedThinking);
        } catch (e) {
          // Not every model accepts every level (3.8-flash rejects MINIMAL).
          // Fall back to the model default rather than failing the trip.
          const msg = e instanceof Error ? e.message : String(e);
          if (!usedThinking || !/thinking/i.test(msg) || !/not supported|invalid/i.test(msg)) throw e;
          console.warn(`[gemini:${stage}] ${model} rejected thinkingLevel=${thinkingConfig?.thinkingLevel}; using model default`);
          thinkingUnsupported.add(model);
          usedThinking = false;
          res = await request(false);
        }
        const u = res.usageMetadata;
        // One line per call: latency is the thing users feel, and this is the
        // only place that can attribute it to a stage, model and thinking level.
        console.info(
          `[gemini:${stage}] ${model} thinking=${usedThinking ? thinkingConfig?.thinkingLevel : "default"} ` +
            `${((Date.now() - t0) / 1000).toFixed(1)}s in=${u?.promptTokenCount ?? "?"} ` +
            `thought=${u?.thoughtsTokenCount ?? 0} out=${u?.candidatesTokenCount ?? "?"}`,
        );
        return res;
      });
    } catch (e) {
      throw toPlannerError(e);
    }

    const callMs = Date.now() - t0;

    if (!raw.trim()) {
      lastIssues = ["Model returned an empty response"];
    } else {
      const parsed = parseAndValidate(raw, schema, verify, normalize);
      if (parsed.ok) return parsed.value;
      lastIssues = parsed.issues;
      // Structurally sound, just imperfect — keep it as a fallback in case we
      // run out of repair attempts.
      if (parsed.usable) softFallback = parsed.usable;
    }

    console.warn(`[gemini:${stage}] rejected:`, lastIssues.slice(0, 6).join(" | ").slice(0, 600));

    // DEADLINE GUARD. A repair costs about as long as the call it replaces.
    // If it can't finish — while leaving room for the stages still to run —
    // attempting it just turns an imperfect itinerary into a timeout error.
    // Measured on 3.8-flash: shortlist ~12s, compose ~20-29s per call.
    const reserveMs = stage === "compose" ? 3_000 : 35_000;
    const repairFits = budget.remainingMs() - reserveMs > callMs * 1.2;

    if (!repairFits || !budget.consumeRepair()) {
      if (softFallback) {
        console.warn(
          `[gemini:${stage}] accepting imperfect output (${repairFits ? "repairs exhausted" : "no time for a repair"}):`,
          lastIssues.join("; "),
        );
        return softFallback;
      }
      throw new ModelOutputError(lastIssues);
    }

    currentPrompt =
      `${prompt}\n\n` +
      `## Correction required\n` +
      `Your previous response was rejected for these reasons:\n` +
      lastIssues.map((i) => `- ${i}`).join("\n") +
      `\n\nReturn corrected JSON matching the schema exactly. Fix only these problems.`;
  }
}

/**
 * Flash is a shared free-tier model and returns 503 "high demand" under load,
 * plus 429 when rate-limited. Those are transient and unrelated to output
 * quality, so they retry with backoff rather than consuming a repair attempt —
 * repairs are for bad output, not for a busy server.
 */
async function callWithTransientRetry(
  call: () => Promise<{ text?: string }>,
): Promise<string> {
  const MAX_TRANSIENT_RETRIES = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      const res = await call();
      return res.text ?? "";
    } catch (e) {
      lastError = e;
      const message = e instanceof Error ? e.message : String(e);
      const transient = /\b(429|503|500|502|504)\b|high demand|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(message);
      if (!transient || attempt === MAX_TRANSIENT_RETRIES) throw e;
      const waitMs = 2 ** (attempt + 1) * 1000 + Math.random() * 500;
      console.warn(
        `[gemini] transient failure (attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES}), retrying in ${Math.round(waitMs / 1000)}s:`,
        // The reason is the whole point of the log: 429 (quota) and 503
        // (overloaded) need opposite fixes, and the line is useless without it.
        message.slice(0, 300),
      );
      // 2s, 4s, 8s — 503s from demand spikes usually clear in seconds.
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

function parseAndValidate<T>(
  raw: string,
  schema: z.ZodType<T>,
  verify?: (value: T) => string[] | { hard?: string[]; soft?: string[] },
  normalize?: (raw: unknown) => unknown,
): { ok: true; value: T } | { ok: false; issues: string[]; usable?: T } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Models occasionally wrap JSON in prose or a fenced block despite
    // responseMimeType. Recover the outermost object rather than burning a
    // repair round on a formatting slip.
    const salvaged = raw.match(/\{[\s\S]*\}/);
    if (!salvaged) return { ok: false, issues: ["Response was not valid JSON"] };
    try {
      json = JSON.parse(salvaged[0]);
    } catch {
      return { ok: false, issues: ["Response was not valid JSON"] };
    }
  }

  if (normalize) {
    try {
      json = normalize(json);
    } catch {
      // A normaliser fault must not mask the model's actual output.
    }
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues
        .slice(0, 12)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }

  const checked = verify?.(result.data) ?? [];
  const hard = Array.isArray(checked) ? checked : (checked.hard ?? []);
  const soft = Array.isArray(checked) ? [] : (checked.soft ?? []);

  if (hard.length > 0) {
    // Genuinely unusable — never fall back to this.
    return { ok: false, issues: [...hard, ...soft].slice(0, 12) };
  }
  if (soft.length > 0) {
    // Worth one more try, but usable if we run out of attempts.
    return { ok: false, issues: soft.slice(0, 12), usable: result.data };
  }

  return { ok: true, value: result.data };
}

/** Used by `npm run probe:models` to discover what a given key can actually call. */
export async function listModels(): Promise<string[]> {
  const names: string[] = [];
  const pager = await ai().models.list();
  for await (const m of pager) {
    if (m.name) names.push(m.name);
  }
  return names;
}

export function assertModelConfigured(): void {
  const model = env().GEMINI_MODEL;
  if (!model) {
    throw new PlannerError({
      kind: "config",
      message: "GEMINI_MODEL is empty",
      userMessage: "Server is misconfigured.",
    });
  }
}
