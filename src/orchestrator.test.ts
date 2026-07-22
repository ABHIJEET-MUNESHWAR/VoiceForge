import { describe, it, expect } from 'vitest';
import { CallOrchestrator } from './orchestrator.js';
import { CallSession, type BookingSlots } from './domain.js';
import { InMemoryBooking, type BookingPort } from './booking.js';
import { MockStt, MockTts, MockTelephony, type TtsPort } from './providers.js';
import { loadConfig, type Config } from './config.js';

function build(overrides: Partial<Config> = {}, booking: BookingPort = new InMemoryBooking(), tts: TtsPort = new MockTts()) {
  const telephony = new MockTelephony();
  const config = { ...loadConfig({}), ...overrides };
  const orchestrator = new CallOrchestrator({
    providers: { stt: new MockStt(), tts, telephony },
    booking,
    config,
  });
  return { orchestrator, telephony };
}

async function say(o: CallOrchestrator, s: CallSession, text: string) {
  return o.handleCallerAudio(s, { bytes: text.length * 32, transcriptHint: text });
}

const FULL: BookingSlots = {
  customerName: 'Jane Doe',
  phone: '5551234567',
  address: '1 Main St',
  trade: 'plumbing',
  urgency: 'emergency',
  description: 'burst pipe',
};

describe('CallOrchestrator happy path', () => {
  it('answers, collects slots across turns, confirms and books', async () => {
    const { orchestrator, telephony } = build();
    const session = new CallSession();

    const greeting = await orchestrator.answer(session);
    expect(greeting.status).toBe('greeting');
    expect(greeting.agentText).toMatch(/how can i help/i);

    await say(orchestrator, session, 'My name is John Carter');
    await say(orchestrator, session, 'reach me at 555 123 4567');
    await say(orchestrator, session, "I'm at 742 Evergreen Terrace");
    await say(orchestrator, session, 'my kitchen sink is leaking');
    const confirm = await say(orchestrator, session, "it's an emergency");
    expect(session.status).toBe('confirming');
    expect(confirm.agentText).toMatch(/should i go ahead and book/i);

    const done = await say(orchestrator, session, 'yes please');
    expect(done.status).toBe('completed');
    expect(done.done).toBe(true);
    expect(done.confirmation?.technician).toBe('Amy Rivera');
    expect(telephony.sentSms).toHaveLength(1);
    expect(session.jobId).toBeDefined();
  });
});

describe('CallOrchestrator branches', () => {
  it('returns to collecting on a negative confirmation', async () => {
    const { orchestrator } = build();
    const session = new CallSession();
    session.transitionTo('greeting');
    session.transitionTo('collecting');
    Object.assign(session.slots, FULL);

    const confirm = await say(orchestrator, session, 'anything');
    expect(session.status).toBe('confirming');
    expect(confirm.agentText).toMatch(/confirm/i);

    const changed = await say(orchestrator, session, 'no not yet');
    expect(session.status).toBe('collecting');
    expect(changed.agentText).toMatch(/what would you like to change/i);
  });

  it('fails gracefully when no technician is available', async () => {
    const { orchestrator, telephony } = build({}, new InMemoryBooking([]));
    const session = new CallSession();
    session.transitionTo('greeting');
    session.transitionTo('collecting');
    Object.assign(session.slots, FULL);

    await say(orchestrator, session, 'anything'); // -> confirming
    const failed = await say(orchestrator, session, 'yes go ahead');
    expect(failed.status).toBe('failed');
    expect(failed.agentText).toMatch(/human/i);
    expect(telephony.sentSms).toHaveLength(0);
  });

  it('escalates to a human when max turns is exceeded', async () => {
    const { orchestrator } = build({ maxTurns: 0 });
    const session = new CallSession();
    await orchestrator.answer(session);
    const escalated = await say(orchestrator, session, 'hello');
    expect(escalated.status).toBe('escalated');
    expect(escalated.done).toBe(true);
  });

  it('detects caller barge-in while the agent is speaking', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slowTts: TtsPort = {
      async synthesize(text) {
        await gate;
        return { bytes: text.length, ms: 80 };
      },
    };
    const { orchestrator } = build({}, new InMemoryBooking(), slowTts);
    const session = new CallSession();

    const answerP = orchestrator.answer(session); // suspends inside TTS, marks speaking
    await Promise.resolve();
    const turnP = say(orchestrator, session, 'wait actually');
    release();
    const turn = await turnP;
    await answerP;
    expect(turn.bargeIn).toBe(true);
  });
});
