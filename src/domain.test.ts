import { describe, it, expect } from 'vitest';
import {
  CallSession,
  canTransition,
  missingSlots,
  slotsComplete,
  toBookingIntent,
  newCallId,
  type BookingSlots,
} from './domain.js';
import { InvalidCallStateError } from './errors.js';

describe('call state machine', () => {
  it('allows the happy-path lifecycle', () => {
    const s = new CallSession();
    expect(s.status).toBe('ringing');
    s.transitionTo('greeting');
    s.transitionTo('collecting');
    s.transitionTo('confirming');
    s.transitionTo('booking');
    s.transitionTo('completed');
    s.transitionTo('ended');
    expect(s.status).toBe('ended');
  });

  it('rejects illegal transitions', () => {
    const s = new CallSession();
    expect(() => s.transitionTo('booking')).toThrow(InvalidCallStateError);
    expect(canTransition('ringing', 'booking')).toBe(false);
    expect(canTransition('collecting', 'confirming')).toBe(true);
  });

  it('records transcript entries', () => {
    const s = new CallSession('call_x', 1000);
    s.record('agent', 'hello', 1001);
    s.record('caller', 'hi', 1002);
    expect(s.transcript).toHaveLength(2);
    expect(s.transcript[0]).toEqual({ role: 'agent', text: 'hello', at: 1001 });
  });
});

describe('slots', () => {
  const full: BookingSlots = {
    customerName: 'Jane',
    phone: '5551234567',
    address: '1 Main St',
    trade: 'plumbing',
    urgency: 'urgent',
    description: 'leak',
  };

  it('detects missing slots', () => {
    expect(missingSlots({})).toHaveLength(6);
    expect(missingSlots(full)).toHaveLength(0);
    expect(slotsComplete(full)).toBe(true);
    expect(slotsComplete({ ...full, phone: '' })).toBe(false);
  });

  it('builds a booking intent from complete slots', () => {
    const intent = toBookingIntent(full);
    expect(intent.customerName).toBe('Jane');
    expect(intent.trade).toBe('plumbing');
  });

  it('throws when building an intent from incomplete slots', () => {
    expect(() => toBookingIntent({ customerName: 'Jane' })).toThrow(/missing/);
  });
});

describe('newCallId', () => {
  it('produces unique prefixed ids', () => {
    const a = newCallId();
    const b = newCallId();
    expect(a).toMatch(/^call_/);
    expect(a).not.toBe(b);
  });
});
