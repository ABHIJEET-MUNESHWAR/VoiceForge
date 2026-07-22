import { describe, it, expect } from 'vitest';
import { withRetry, withTimeout } from './reliability.js';
import { ProviderError, TimeoutError } from './errors.js';

describe('withTimeout', () => {
  it('resolves fast operations', async () => {
    await expect(withTimeout(async () => 42, 100, 'op')).resolves.toBe(42);
  });

  it('rejects operations that exceed the budget', async () => {
    await expect(
      withTimeout(() => new Promise((r) => setTimeout(r, 50)), 10, 'slow'),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('withRetry', () => {
  const noSleep = async (): Promise<void> => undefined;

  it('returns the first successful result', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return 'ok';
      },
      { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep, random: () => 0 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries retryable errors then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new ProviderError('deepgram', 'flaky');
        return calls;
      },
      { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 4, sleep: noSleep, random: () => 0.5 },
    );
    expect(result).toBe(3);
  });

  it('stops retrying non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new ProviderError('twilio', 'fatal', false);
        },
        {
          maxRetries: 5,
          baseDelayMs: 1,
          maxDelayMs: 1,
          sleep: noSleep,
          retryable: (e) => e instanceof ProviderError && e.retryable,
        },
      ),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(1);
  });

  it('gives up after maxRetries', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new ProviderError('deepgram', 'always');
        },
        { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep, random: () => 0 },
      ),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(3);
  });
});
