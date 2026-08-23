import { LIMITS } from "../config";

/**
 * PROMPT-INJECTION GUARDRAIL.
 *
 * Two untrusted sources reach the model:
 *   1. The user's free-text answer.
 *   2. Google Place reviews — user-generated content written by strangers,
 *      which is the vector people usually forget.
 *
 * Defence is layered, because no single layer is reliable:
 *   - Neutralise instruction-shaped phrasing here.
 *   - Fence untrusted spans and label them as data in the prompt.
 *   - Structurally validate output against the real place pool, so even a
 *     successful injection cannot invent a destination or a stop.
 *
 * The third layer is the one that actually holds; the first two just reduce
 * how often it has to.
 */

const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)\b/gi, "[filtered]"],
  [/\bdisregard\s+(all\s+)?(previous|prior|above)\b/gi, "[filtered]"],
  [/\b(system|developer)\s*(prompt|message|instruction)s?\b/gi, "[filtered]"],
  [/\byou\s+are\s+now\s+(a|an)\b/gi, "[filtered]"],
  [/\bnew\s+instructions?\s*:/gi, "[filtered]"],
  [/\boverride\s+(your|the)\s+\w+/gi, "[filtered]"],
  [/<\|[^|]*\|>/g, ""],
  [/\b(assistant|model|user)\s*:/gi, ""],
];

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Strips control characters and collapses runaway whitespace. */
function normalize(input: string): string {
  return input.replace(CONTROL_CHARS, "").replace(/\s{3,}/g, "  ").trim();
}

function neutralize(input: string): string {
  let out = input;
  for (const [pattern, replacement] of INJECTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Sanitises the user's own free-text answer. */
export function sanitizeUserText(input: string | undefined): string {
  if (!input) return "";
  return neutralize(normalize(input)).slice(0, LIMITS.MAX_FREETEXT_CHARS);
}

/** Sanitises third-party review text before it enters the compose prompt. */
export function sanitizeReview(input: string): string {
  return neutralize(normalize(input)).slice(0, LIMITS.MAX_REVIEW_CHARS);
}

/**
 * Wraps untrusted content in a labelled fence. Backticks inside the payload are
 * escaped so it cannot close its own fence and escape into instruction space.
 */
export function fence(label: string, content: string): string {
  const safe = content.replace(/```/g, "'''");
  return `<${label}>\n${safe}\n</${label}>`;
}
