import { InvalidCallStateError } from './errors.js';

/** Home-service trades the voice agent can dispatch. */
export const TRADES = ['plumbing', 'hvac', 'electrical', 'roofing', 'general'] as const;
export type Trade = (typeof TRADES)[number];

/** Urgency levels drive slot availability and dispatch priority. */
export const URGENCIES = ['emergency', 'urgent', 'routine'] as const;
export type Urgency = (typeof URGENCIES)[number];

/**
 * Lifecycle of a single inbound call. Encoded as an explicit state machine so
 * illegal transitions (e.g. booking before the slots are collected) are a
 * compile-time-shaped runtime error rather than a silent bug.
 */
export type CallStatus =
  | 'ringing'
  | 'greeting'
  | 'collecting'
  | 'confirming'
  | 'booking'
  | 'completed'
  | 'escalated'
  | 'failed'
  | 'ended';

const TRANSITIONS: Readonly<Record<CallStatus, readonly CallStatus[]>> = {
  ringing: ['greeting', 'failed', 'ended'],
  greeting: ['collecting', 'escalated', 'failed', 'ended'],
  collecting: ['collecting', 'confirming', 'escalated', 'failed', 'ended'],
  confirming: ['booking', 'collecting', 'escalated', 'failed', 'ended'],
  booking: ['completed', 'failed', 'escalated'],
  completed: ['ended'],
  escalated: ['ended'],
  failed: ['ended'],
  ended: [],
};

export function canTransition(from: CallStatus, to: CallStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Slots the agent must collect before it can book a job. */
export interface BookingSlots {
  customerName?: string;
  phone?: string;
  address?: string;
  trade?: Trade;
  urgency?: Urgency;
  description?: string;
}

export const REQUIRED_SLOTS = [
  'customerName',
  'phone',
  'address',
  'trade',
  'urgency',
  'description',
] as const satisfies readonly (keyof BookingSlots)[];

export function missingSlots(slots: BookingSlots): (keyof BookingSlots)[] {
  return REQUIRED_SLOTS.filter((key) => {
    const v = slots[key];
    return v === undefined || v === '';
  });
}

export function slotsComplete(slots: BookingSlots): boolean {
  return missingSlots(slots).length === 0;
}

/** A fully-collected, ready-to-book intent (all slots present). */
export interface BookingIntent {
  readonly customerName: string;
  readonly phone: string;
  readonly address: string;
  readonly trade: Trade;
  readonly urgency: Urgency;
  readonly description: string;
}

export function toBookingIntent(slots: BookingSlots): BookingIntent {
  if (!slotsComplete(slots)) {
    throw new Error(`Cannot build booking intent, missing: ${missingSlots(slots).join(', ')}`);
  }
  return {
    customerName: slots.customerName!,
    phone: slots.phone!,
    address: slots.address!,
    trade: slots.trade!,
    urgency: slots.urgency!,
    description: slots.description!,
  };
}

let counter = 0;
export function newCallId(): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `call_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

/** In-memory aggregate for one call. Mutates its own state through `transitionTo`. */
export class CallSession {
  readonly id: string;
  readonly startedAt: number;
  private _status: CallStatus = 'ringing';
  readonly slots: BookingSlots = {};
  readonly transcript: { role: 'agent' | 'caller'; text: string; at: number }[] = [];
  turns = 0;
  jobId?: string;

  constructor(id: string = newCallId(), startedAt: number = Date.now()) {
    this.id = id;
    this.startedAt = startedAt;
  }

  get status(): CallStatus {
    return this._status;
  }

  transitionTo(next: CallStatus): void {
    if (!canTransition(this._status, next)) {
      throw new InvalidCallStateError(this._status, next);
    }
    this._status = next;
  }

  record(role: 'agent' | 'caller', text: string, at: number = Date.now()): void {
    this.transcript.push({ role, text, at });
  }
}
