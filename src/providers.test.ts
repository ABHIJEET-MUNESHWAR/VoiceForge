import { describe, it, expect } from 'vitest';
import { MockStt, MockTts, MockTelephony, mockProviders, liveProviders } from './providers.js';
import { ProviderError } from './errors.js';

describe('mock providers', () => {
  it('transcribes the hint text', async () => {
    const t = await new MockStt().transcribe({ bytes: 10, transcriptHint: 'hello there' });
    expect(t.text).toBe('hello there');
    expect(t.confidence).toBeGreaterThan(0.9);
  });

  it('reports low confidence for empty audio', async () => {
    const t = await new MockStt().transcribe({ bytes: 0 });
    expect(t.text).toBe('');
    expect(t.confidence).toBeLessThan(0.5);
  });

  it('synthesizes speech with a byte estimate', async () => {
    const s = await new MockTts().synthesize('hi');
    expect(s.bytes).toBeGreaterThan(0);
    expect(s.ms).toBeGreaterThanOrEqual(0);
  });

  it('records SMS and hangups', async () => {
    const tel = new MockTelephony();
    const { id } = await tel.sendSms('+15551234567', 'booked');
    await tel.hangup('call_1');
    expect(tel.sentSms).toHaveLength(1);
    expect(id).toBe('sms_1');
    expect(tel.hangups).toEqual(['call_1']);
  });

  it('builds a full mock provider set', () => {
    const p = mockProviders();
    expect(p.stt).toBeInstanceOf(MockStt);
    expect(p.tts).toBeInstanceOf(MockTts);
  });
});

describe('live providers', () => {
  it('fails fast without credentials', () => {
    expect(() => liveProviders({})).toThrow(ProviderError);
  });

  it('fails because adapters are not bundled even with credentials', () => {
    expect(() =>
      liveProviders({
        deepgramApiKey: 'a',
        elevenLabsApiKey: 'b',
        twilioAccountSid: 'c',
        twilioAuthToken: 'd',
      }),
    ).toThrow(/not bundled/);
  });
});
