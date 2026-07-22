import { ProviderError } from './errors.js';

/**
 * Provider ports (hexagonal boundaries). The orchestrator depends only on
 * these interfaces — never on Twilio / Deepgram / ElevenLabs directly — so the
 * whole pipeline is testable offline with deterministic mocks and swappable for
 * real vendors in production via configuration.
 */

/** A chunk of caller audio. In tests the mock STT reads `transcriptHint`. */
export interface AudioChunk {
  readonly bytes: number;
  readonly transcriptHint?: string;
}

export interface Transcript {
  readonly text: string;
  readonly confidence: number;
  readonly ms: number;
}

export interface SpeechResult {
  readonly bytes: number;
  readonly ms: number;
}

/** Speech-to-text port (production adapter: Deepgram). */
export interface SttPort {
  transcribe(audio: AudioChunk): Promise<Transcript>;
}

/** Text-to-speech port (production adapter: ElevenLabs / Cartesia). */
export interface TtsPort {
  synthesize(text: string): Promise<SpeechResult>;
}

/** Telephony port for outbound side-effects (production adapter: Twilio). */
export interface TelephonyPort {
  sendSms(to: string, body: string): Promise<{ id: string }>;
  hangup(callId: string): Promise<void>;
}

export interface VoiceProviders {
  readonly stt: SttPort;
  readonly tts: TtsPort;
  readonly telephony: TelephonyPort;
}

// --- Deterministic mocks (default; no network) ---------------------------------

export class MockStt implements SttPort {
  constructor(private readonly latencyMs = 40) {}
  async transcribe(audio: AudioChunk): Promise<Transcript> {
    const text = (audio.transcriptHint ?? '').trim();
    return { text, confidence: text ? 0.97 : 0.2, ms: this.latencyMs };
  }
}

export class MockTts implements TtsPort {
  constructor(private readonly latencyMs = 60) {}
  async synthesize(text: string): Promise<SpeechResult> {
    // ~16 kHz mono PCM16 estimate: 32 bytes per character is plenty for a mock.
    return { bytes: Math.max(1, text.length) * 32, ms: this.latencyMs };
  }
}

export class MockTelephony implements TelephonyPort {
  readonly sentSms: { to: string; body: string; id: string }[] = [];
  readonly hangups: string[] = [];
  private seq = 0;

  async sendSms(to: string, body: string): Promise<{ id: string }> {
    this.seq += 1;
    const id = `sms_${this.seq}`;
    this.sentSms.push({ to, body, id });
    return { id };
  }

  async hangup(callId: string): Promise<void> {
    this.hangups.push(callId);
  }
}

export function mockProviders(): VoiceProviders {
  return { stt: new MockStt(), tts: new MockTts(), telephony: new MockTelephony() };
}

// --- Live adapter seams (production; require credentials) -----------------------

interface LiveConfig {
  readonly deepgramApiKey?: string | undefined;
  readonly elevenLabsApiKey?: string | undefined;
  readonly twilioAccountSid?: string | undefined;
  readonly twilioAuthToken?: string | undefined;
}

/**
 * Placeholder live adapters that document the production wiring surface. They
 * fail fast with a typed {@link ProviderError} when credentials are absent so a
 * misconfigured deployment cannot silently fall back to mocks.
 */
export function liveProviders(cfg: LiveConfig): VoiceProviders {
  const require = (value: string | undefined, name: string): string => {
    if (!value) throw new ProviderError(name, 'missing credentials', false);
    return value;
  };
  require(cfg.deepgramApiKey, 'deepgram');
  require(cfg.elevenLabsApiKey, 'elevenlabs');
  require(cfg.twilioAccountSid, 'twilio');
  require(cfg.twilioAuthToken, 'twilio');
  throw new ProviderError('voiceforge', 'live provider adapters not bundled in this build', false);
}
