import { type Config } from './config.js';
import {
  type CallSession,
  slotsComplete,
  toBookingIntent,
} from './domain.js';
import { DialogEngine } from './dialog.js';
import { type BookingPort, type BookingConfirmation } from './booking.js';
import { type VoiceProviders, type AudioChunk } from './providers.js';
import { MetricsRegistry } from './metrics.js';
import { withRetry, withTimeout } from './reliability.js';
import { isRetryable, BookingError } from './errors.js';

export interface AgentTurn {
  readonly callId: string;
  readonly status: CallSession['status'];
  readonly agentText: string;
  readonly sttMs: number;
  readonly ttsMs: number;
  readonly bargeIn: boolean;
  readonly done: boolean;
  readonly confirmation?: BookingConfirmation;
}

export interface OrchestratorDeps {
  readonly providers: VoiceProviders;
  readonly booking: BookingPort;
  readonly config: Config;
  readonly dialog?: DialogEngine;
  readonly metrics?: MetricsRegistry;
}

const AFFIRMATIVE = /\b(yes|yeah|yep|sure|please|go ahead|correct|book it|confirm|okay|ok)\b/i;

/**
 * Drives a single inbound call through its lifecycle: greet, slot-fill via the
 * dialog engine, confirm, book (guarded by retry + timeout), and send an SMS
 * confirmation. Every speech-provider call is latency-bounded so a slow vendor
 * cannot stall the live call.
 */
export class CallOrchestrator {
  private readonly providers: VoiceProviders;
  private readonly booking: BookingPort;
  private readonly config: Config;
  private readonly dialog: DialogEngine;
  private readonly metrics: MetricsRegistry;
  /** Tracks whether the agent is mid-utterance to detect caller barge-in. */
  private readonly speaking = new Set<string>();

  constructor(deps: OrchestratorDeps) {
    this.providers = deps.providers;
    this.booking = deps.booking;
    this.config = deps.config;
    this.dialog = deps.dialog ?? new DialogEngine();
    this.metrics = deps.metrics ?? new MetricsRegistry();
  }

  /** Answer the call: play the greeting and invite the caller to speak. */
  async answer(session: CallSession): Promise<AgentTurn> {
    session.transitionTo('greeting');
    const text = `Thanks for calling ${this.config.companyName}. This is ${this.config.agentName}, your virtual assistant. How can I help you today?`;
    const { ms } = await this.speak(session, text);
    return this.turn(session, text, 0, ms, false, false);
  }

  /**
   * Process one chunk of caller audio and produce the agent's spoken response.
   * This is the heart of the turn-taking loop.
   */
  async handleCallerAudio(session: CallSession, audio: AudioChunk): Promise<AgentTurn> {
    const turnStart = performance.now();
    const bargeIn = this.speaking.has(session.id);
    if (bargeIn) {
      this.speaking.delete(session.id);
      this.metrics.counter('voiceforge_bargein_total', 'Caller barge-ins').inc();
    }

    session.turns += 1;
    this.metrics.counter('voiceforge_turns_total', 'Caller turns processed').inc();

    if (session.turns > this.config.maxTurns) {
      return this.escalate(session, 'This is taking a while — let me connect you with a human agent.', 0, turnStart);
    }

    const transcript = await this.metrics.time(
      'voiceforge_stt_latency_ms',
      'STT latency',
      {},
      () => withTimeout(() => this.providers.stt.transcribe(audio), this.config.turnTimeoutMs, 'stt'),
    );
    const sttMs = transcript.ms;
    session.record('caller', transcript.text);

    let agentText: string;
    let confirmation: BookingConfirmation | undefined;

    if (session.status === 'greeting') {
      session.transitionTo('collecting');
    }

    if (session.status === 'confirming') {
      if (AFFIRMATIVE.test(transcript.text)) {
        const result = await this.performBooking(session);
        if (result.ok) {
          confirmation = result.value;
          agentText = `You're all set. ${confirmation.technician} will be there in about ${confirmation.etaMinutes} minutes. I've texted a confirmation to ${session.slots.phone}. Anything else?`;
        } else {
          agentText = `I'm sorry, I couldn't complete the booking. Let me get a human to help you.`;
        }
      } else {
        agentText = 'No problem. What would you like to change?';
        session.transitionTo('collecting');
      }
    } else {
      // collecting: update slots from the utterance and ask the next question.
      const patch = this.dialog.ingest(transcript.text, session.slots);
      Object.assign(session.slots, patch);

      if (slotsComplete(session.slots)) {
        session.transitionTo('confirming');
        const s = session.slots;
        agentText = `Let me confirm: a ${s.urgency} ${s.trade} visit for ${s.customerName} at ${s.address}. Should I go ahead and book it?`;
      } else {
        agentText = this.dialog.next(session.slots).prompt;
      }
    }

    const { ms: ttsMs } = await this.speak(session, agentText);
    const result = this.turn(session, agentText, sttMs, ttsMs, bargeIn, confirmation !== undefined, confirmation);
    this.metrics
      .histogram('voiceforge_turn_latency_ms', 'End-to-end turn latency')
      .observe(performance.now() - turnStart);
    return result;
  }

  /** Books the collected intent, guarded by retry + timeout. */
  private async performBooking(
    session: CallSession,
  ): Promise<{ ok: true; value: BookingConfirmation } | { ok: false }> {
    session.transitionTo('booking');
    const intent = toBookingIntent(session.slots);
    try {
      const confirmation = await withRetry(
        () => withTimeout(() => this.booking.book(intent), this.config.turnTimeoutMs, 'booking'),
        {
          maxRetries: 2,
          baseDelayMs: 20,
          maxDelayMs: 200,
          retryable: (e) => isRetryable(e) && !(e instanceof BookingError),
        },
      );
      session.jobId = confirmation.jobId;
      session.transitionTo('completed');
      await this.providers.telephony.sendSms(
        intent.phone,
        `${this.config.companyName}: ${confirmation.technician} is booked for your ${intent.trade} job (${confirmation.jobId}), ETA ~${confirmation.etaMinutes} min.`,
      );
      this.metrics.counter('voiceforge_bookings_total', 'Bookings', ).inc({ result: 'ok' });
      this.metrics.counter('voiceforge_calls_total', 'Calls by outcome').inc({ outcome: 'completed' });
      return { ok: true, value: confirmation };
    } catch (error) {
      session.transitionTo('failed');
      this.metrics.counter('voiceforge_bookings_total', 'Bookings').inc({ result: 'error' });
      this.metrics.counter('voiceforge_calls_total', 'Calls by outcome').inc({ outcome: 'failed' });
      void error;
      return { ok: false };
    }
  }

  private async escalate(
    session: CallSession,
    text: string,
    sttMs: number,
    turnStart: number,
  ): Promise<AgentTurn> {
    session.transitionTo('escalated');
    this.metrics.counter('voiceforge_calls_total', 'Calls by outcome').inc({ outcome: 'escalated' });
    const { ms } = await this.speak(session, text);
    const result = this.turn(session, text, sttMs, ms, false, true);
    this.metrics
      .histogram('voiceforge_turn_latency_ms', 'End-to-end turn latency')
      .observe(performance.now() - turnStart);
    return result;
  }

  private async speak(session: CallSession, text: string): Promise<{ ms: number }> {
    this.speaking.add(session.id);
    const speech = await this.metrics.time('voiceforge_tts_latency_ms', 'TTS latency', {}, () =>
      withTimeout(() => this.providers.tts.synthesize(text), this.config.turnTimeoutMs, 'tts'),
    );
    session.record('agent', text);
    this.speaking.delete(session.id);
    return { ms: speech.ms };
  }

  private turn(
    session: CallSession,
    agentText: string,
    sttMs: number,
    ttsMs: number,
    bargeIn: boolean,
    done: boolean,
    confirmation?: BookingConfirmation,
  ): AgentTurn {
    return {
      callId: session.id,
      status: session.status,
      agentText,
      sttMs,
      ttsMs,
      bargeIn,
      done,
      ...(confirmation ? { confirmation } : {}),
    };
  }
}
