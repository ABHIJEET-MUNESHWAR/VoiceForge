/**
 * Typed error hierarchy for VoiceForge. Every error carries a stable `code`
 * and a `retryable` hint so callers (and the resilience layer) can make
 * recovery decisions without string matching.
 */
export abstract class VoiceForgeError extends Error {
  abstract readonly code: string;
  readonly retryable: boolean;
  readonly context: Readonly<Record<string, unknown>>;

  protected constructor(
    message: string,
    options: { retryable?: boolean; context?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.retryable = options.retryable ?? false;
    this.context = Object.freeze({ ...(options.context ?? {}) });
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** The dialog reached an illegal state transition. */
export class InvalidCallStateError extends VoiceForgeError {
  readonly code = 'INVALID_CALL_STATE';
  constructor(from: string, to: string) {
    super(`Illegal call transition ${from} -> ${to}`, { context: { from, to } });
  }
}

/** A speech-to-text / text-to-speech / telephony provider failed. */
export class ProviderError extends VoiceForgeError {
  readonly code = 'PROVIDER_ERROR';
  constructor(provider: string, message: string, retryable = true, cause?: unknown) {
    super(`${provider}: ${message}`, { retryable, context: { provider }, cause });
  }
}

/** An operation exceeded its latency budget. */
export class TimeoutError extends VoiceForgeError {
  readonly code = 'TIMEOUT';
  constructor(operation: string, ms: number) {
    super(`Operation '${operation}' timed out after ${ms}ms`, {
      retryable: true,
      context: { operation, ms },
    });
  }
}

/** The downstream booking system rejected or failed the request. */
export class BookingError extends VoiceForgeError {
  readonly code = 'BOOKING_ERROR';
  constructor(message: string, retryable = false, cause?: unknown) {
    super(message, { retryable, cause });
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof VoiceForgeError && error.retryable;
}
