import { TimeoutError } from './errors.js';

/**
 * Reject an operation that exceeds its latency budget. Used to bound every
 * speech-provider call so a slow vendor cannot stall a live phone call.
 */
export async function withTimeout<T>(
  op: () => Promise<T>,
  ms: number,
  name: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(name, ms)), ms);
  });
  try {
    return await Promise.race([op(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryOptions {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Injectable for deterministic tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly retryable?: (error: unknown) => boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter, retrying only retryable errors. */
export async function withRetry<T>(op: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const retryable = opts.retryable ?? (() => true);
  let attempt = 0;
  for (;;) {
    try {
      return await op();
    } catch (error) {
      if (attempt >= opts.maxRetries || !retryable(error)) throw error;
      const backoff = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
      await sleep(Math.floor(random() * backoff));
      attempt += 1;
    }
  }
}
