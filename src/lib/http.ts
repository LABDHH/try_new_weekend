import type { Budget } from "./budget";
import { UpstreamError, redact, toPlannerError } from "./errors";

type JsonRequest = {
  api: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  budget: Budget;
  sku: string;
  /** Retries only apply to 429/5xx and network faults; 4xx fails immediately. */
  maxRetries?: number;
};

/**
 * The single outbound path for every Google API call.
 *
 * Centralising it means timeout, retry-with-backoff, budget accounting and key
 * redaction are guaranteed rather than remembered at each call site.
 */
export async function fetchJson<T>(req: JsonRequest): Promise<T> {
  const { api, url, method = "GET", headers = {}, body, budget, sku } = req;
  const maxRetries = req.maxRetries ?? 2;

  budget.chargeMaps(sku);

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Each attempt gets the smaller of the per-call timeout and what remains
    // of the whole-pipeline deadline.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), budget.callTimeoutMs());

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new UpstreamError(api, res.status, redact(text));
        // 4xx (other than rate limiting) means the request is wrong; retrying
        // it unchanged just spends budget to get the same answer.
        if (!err.retryable || attempt === maxRetries) throw err;
        lastError = err;
        await backoff(attempt, res);
        continue;
      }

      return (await res.json()) as T;
    } catch (e) {
      const err = toPlannerError(e);
      if (attempt === maxRetries || (err.kind !== "upstream" && err.kind !== "timeout")) {
        throw err;
      }
      lastError = err;
      await backoff(attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw toPlannerError(lastError);
}

/** Exponential backoff with jitter, honouring Retry-After when the server sends it. */
async function backoff(attempt: number, res?: Response): Promise<void> {
  const retryAfter = res?.headers.get("retry-after");
  const serverMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
  const base = Number.isFinite(serverMs) ? serverMs : 2 ** attempt * 400;
  const jitter = Math.random() * 250;
  await new Promise((r) => setTimeout(r, Math.min(base + jitter, 5_000)));
}
