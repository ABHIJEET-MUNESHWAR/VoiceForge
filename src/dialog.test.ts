import { describe, it, expect } from 'vitest';
import { DialogEngine, RuleBasedNlu } from './dialog.js';
import { type BookingSlots } from './domain.js';

describe('RuleBasedNlu', () => {
  const nlu = new RuleBasedNlu();

  it('extracts a name', () => {
    expect(nlu.extract('My name is John Carter', {}).customerName).toBe('John Carter');
  });

  it('extracts and normalizes a phone number', () => {
    expect(nlu.extract('you can reach me at 555 123 4567', {}).phone).toBe('5551234567');
  });

  it('extracts an address introduced by a cue word', () => {
    expect(nlu.extract("I'm at 742 Evergreen Terrace", {}).address).toBe('742 Evergreen Terrace');
  });

  it('extracts a bare street address', () => {
    expect(nlu.extract('12 Baker Street', {}).address).toBe('12 Baker Street');
  });

  it('detects the trade and keeps the description', () => {
    const patch = nlu.extract('my kitchen sink is leaking', {});
    expect(patch.trade).toBe('plumbing');
    expect(patch.description).toBe('my kitchen sink is leaking');
  });

  it('detects urgency', () => {
    expect(nlu.extract('this is an emergency', {}).urgency).toBe('emergency');
    expect(nlu.extract('no rush, next week is fine', {}).urgency).toBe('routine');
  });

  it('does not overwrite already-known slots', () => {
    const current: BookingSlots = { phone: '5550000000' };
    expect(nlu.extract('call me at 555 999 8888', current).phone).toBeUndefined();
  });

  it('returns an empty patch for empty input', () => {
    expect(nlu.extract('', {})).toEqual({});
  });
});

describe('DialogEngine', () => {
  const engine = new DialogEngine();

  it('asks for the first missing slot', () => {
    const step = engine.next({});
    expect(step.done).toBe(false);
    expect(step.missing[0]).toBe('customerName');
    expect(step.prompt).toMatch(/name/i);
  });

  it('reports done when all slots are filled', () => {
    const step = engine.next({
      customerName: 'A',
      phone: '1',
      address: 'x',
      trade: 'hvac',
      urgency: 'urgent',
      description: 'd',
    });
    expect(step.done).toBe(true);
    expect(step.prompt).toBe('');
  });

  it('ingests an utterance into a slot patch', () => {
    expect(engine.ingest('this is an emergency', {}).urgency).toBe('emergency');
  });
});
