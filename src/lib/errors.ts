/**
 * Typed errors so the pipeline can distinguish "degrade gracefully" from
 * "abort". Anything user-facing carries a `userMessage` that is safe to render
 * — upstream API errors never reach the browser verbatim.
 */

export type ErrorKind =
  | "config"
  | "validation"
  | "upstream"
  | "budget"
  | "timeout"
  | "no_results"
  | "model_output";

export class PlannerError extends Error {
  readonly kind: ErrorKind;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(opts: {
    kind: ErrorKind;
    message: string;
    userMessage?: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "PlannerError";
    this.kind = opts.kind;
    this.userMessage = opts.userMessage ?? "Something went wrong planning your trip.";
    this.retryable = opts.retryable ?? false;
    this.cause = opts.cause;
  }
}

export class BudgetExceededError extends PlannerError {
  constructor(resource: string, limit: number) {
    super({
      kind: "budget",
      message: `Budget exceeded for ${resource} (limit ${limit})`,
      userMessage: "This trip took more work than expected to plan. Try again, or narrow your drive time.",
      retryable: true,
    });
    this.name = "BudgetExceededError";
  }
}

export class UpstreamError extends PlannerError {
  readonly status: number;
  readonly api: string;

  constructor(api: string, status: number, body: string) {
    super({
      kind: "upstream",
      // Body is truncated: Google error payloads can be enormous and may echo the key.
      message: `${api} returned ${status}: ${body.slice(0, 500)}`,
      userMessage: "We couldn't reach one of our data sources just now.",
      retryable: status === 429 || status >= 500,
    });
    this.name = "UpstreamError";
    this.status = status;
    this.api = api;
  }
}

export class NoResultsError extends PlannerError {
  constructor(userMessage: string) {
    super({ kind: "no_results", message: userMessage, userMessage, retryable: false });
    this.name = "NoResultsError";
  }
}

export class ModelOutputError extends PlannerError {
  readonly issues: string[];

  constructor(issues: string[]) {
    super({
      kind: "model_output",
      message: `Model output failed validation: ${issues.join("; ")}`,
      userMessage: "We had trouble assembling your itinerary. Try again.",
      retryable: true,
    });
    this.name = "ModelOutputError";
    this.issues = issues;
  }
}

/** Redacts API keys before anything is logged. Keys ride in query strings. */
export function redact(input: string): string {
  return input
    .replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(AIza)[A-Za-z0-9_\-]{20,}/g, "$1[REDACTED]");
}

export function toPlannerError(e: unknown): PlannerError {
  if (e instanceof PlannerError) return e;
  if (e instanceof Error && e.name === "AbortError") {
    return new PlannerError({
      kind: "timeout",
      message: "Request timed out",
      userMessage: "That took too long. Try again.",
      retryable: true,
    });
  }
  return new PlannerError({
    kind: "upstream",
    message: redact(e instanceof Error ? e.message : String(e)),
    cause: e,
  });
}
