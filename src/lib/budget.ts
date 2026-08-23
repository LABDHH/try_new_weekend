import { BUDGET } from "./config";
import { BudgetExceededError, PlannerError } from "./errors";

/**
 * Per-request spend ledger.
 *
 * Every outbound call — Maps or Gemini — is checked against this before it
 * happens and recorded after. Three things it prevents:
 *   1. A retry loop quietly burning hundreds of paid Places calls.
 *   2. A repair loop bouncing off a model that will never return valid JSON.
 *   3. A pipeline hanging past the point the user has already given up.
 *
 * One instance per plan request, threaded through the whole pipeline.
 */
export class Budget {
  private geminiCalls = 0;
  private mapsCalls = 0;
  private repairAttempts = 0;
  private readonly startedAt = Date.now();
  private readonly bySku = new Map<string, number>();

  /** Throws if the whole-pipeline deadline has passed. Checked at each stage boundary. */
  assertTimeRemaining(): void {
    if (this.elapsedMs() > BUDGET.WALL_CLOCK_MS) {
      throw new PlannerError({
        kind: "timeout",
        message: `Pipeline exceeded ${BUDGET.WALL_CLOCK_MS}ms`,
        userMessage: "Planning took too long. Try a shorter drive-time range.",
        retryable: true,
      });
    }
  }

  /** Milliseconds left before the deadline, floored at zero. */
  remainingMs(): number {
    return Math.max(0, BUDGET.WALL_CLOCK_MS - this.elapsedMs());
  }

  /** Timeout for a single call: never longer than the budget that remains. */
  callTimeoutMs(): number {
    return Math.min(BUDGET.SINGLE_CALL_TIMEOUT_MS, this.remainingMs() || 1);
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  chargeMaps(sku: string, count = 1): void {
    this.assertTimeRemaining();
    if (this.mapsCalls + count > BUDGET.MAX_MAPS_CALLS) {
      throw new BudgetExceededError("Maps API calls", BUDGET.MAX_MAPS_CALLS);
    }
    this.mapsCalls += count;
    this.bySku.set(sku, (this.bySku.get(sku) ?? 0) + count);
  }

  chargeGemini(stage: string): void {
    this.assertTimeRemaining();
    if (this.geminiCalls + 1 > BUDGET.MAX_GEMINI_CALLS) {
      throw new BudgetExceededError("Gemini calls", BUDGET.MAX_GEMINI_CALLS);
    }
    this.geminiCalls += 1;
    this.bySku.set(`gemini:${stage}`, (this.bySku.get(`gemini:${stage}`) ?? 0) + 1);
  }

  /**
   * Repair attempts are budgeted separately from calls. A model that returns
   * malformed output twice will not do better on the fifth try, and each
   * attempt costs a full request.
   */
  consumeRepair(): boolean {
    if (this.repairAttempts >= BUDGET.MAX_REPAIR_ATTEMPTS) return false;
    this.repairAttempts += 1;
    return true;
  }

  /** Structured summary for logging and the debug payload. */
  snapshot() {
    return {
      geminiCalls: this.geminiCalls,
      mapsCalls: this.mapsCalls,
      repairAttempts: this.repairAttempts,
      elapsedMs: this.elapsedMs(),
      bySku: Object.fromEntries(this.bySku),
    };
  }
}
