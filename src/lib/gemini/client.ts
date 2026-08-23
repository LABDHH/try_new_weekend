import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";
import type { Budget } from "../budget";
import { BUDGET, env } from "../config";
import { ModelOutputError, PlannerError, toPlannerError } from "../errors";
import { toGeminiSchema } from "../schema/itinerary";

let client: GoogleGenAI | null = null;

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
   * Extra semantic checks beyond shape — e.g. "every placeId exists in the
   * pool". Returning issues triggers a repair round rather than accepting
   * output that parses but is wrong.
   */
  verify?: (value: T) => string[];
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

  for (;;) {
    budget.chargeGemini(stage);

    let raw: string;
    try {
      raw = await callWithTransientRetry(() =>
        ai().models.generateContent({
          model: env().GEMINI_MODEL,
          contents: currentPrompt,
          config: {
            systemInstruction: system,
            responseMimeType: "application/json",
            responseSchema,
            temperature: opts.temperature ?? 0.7,
            maxOutputTokens: BUDGET.MAX_OUTPUT_TOKENS,
          },
        }),
      );
    } catch (e) {
      throw toPlannerError(e);
    }

    if (!raw.trim()) {
      lastIssues = ["Model returned an empty response"];
    } else {
      const parsed = parseAndValidate(raw, schema, verify, normalize);
      if (parsed.ok) return parsed.value;
      lastIssues = parsed.issues;
    }

    if (!budget.consumeRepair()) throw new ModelOutputError(lastIssues);

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
        `[gemini] transient failure (attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES}), retrying in ${Math.round(waitMs / 1000)}s`,
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
  verify?: (value: T) => string[],
  normalize?: (raw: unknown) => unknown,
): { ok: true; value: T } | { ok: false; issues: string[] } {
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

  const semantic = verify?.(result.data) ?? [];
  if (semantic.length > 0) return { ok: false, issues: semantic.slice(0, 12) };

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
