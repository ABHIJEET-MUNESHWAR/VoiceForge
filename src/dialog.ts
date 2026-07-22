import {
  type BookingSlots,
  type Trade,
  type Urgency,
  TRADES,
  missingSlots,
} from './domain.js';

/**
 * Natural-language understanding port. The default {@link RuleBasedNlu} is
 * fully deterministic (regex + keyword extraction) so the dialog is testable
 * without a model; a production build can drop in an LLM-backed extractor
 * behind the same interface.
 */
export interface NluPort {
  extract(utterance: string, current: BookingSlots): Partial<BookingSlots>;
}

const TRADE_KEYWORDS: Record<Trade, readonly string[]> = {
  plumbing: ['plumb', 'leak', 'pipe', 'drain', 'faucet', 'toilet', 'water heater', 'sewer'],
  hvac: ['hvac', 'ac', 'air condition', 'furnace', 'heating', 'cooling', 'thermostat', 'no cool'],
  electrical: ['electric', 'wiring', 'outlet', 'breaker', 'panel', 'spark', 'power'],
  roofing: ['roof', 'shingle', 'gutter', 'ceiling leak'],
  general: ['handyman', 'general', 'repair', 'fix'],
};

const URGENCY_KEYWORDS: Record<Urgency, readonly string[]> = {
  emergency: ['emergency', 'urgent', 'right now', 'immediately', 'flooding', 'no power', 'burst', 'gas'],
  urgent: ['today', 'asap', 'as soon as', 'soon', 'this morning', 'this afternoon'],
  routine: ['whenever', 'no rush', 'next week', 'sometime', 'routine', 'schedule'],
};

const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

/** Word-start match so "leak" hits "leaking" but "ac" does not hit "reach". */
function hasKeyword(text: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);
}

function detectTrade(text: string): Trade | undefined {
  for (const trade of TRADES) {
    if (TRADE_KEYWORDS[trade].some((k) => hasKeyword(text, k))) return trade;
  }
  return undefined;
}

function detectUrgency(text: string): Urgency | undefined {
  for (const urgency of ['emergency', 'urgent', 'routine'] as const) {
    if (URGENCY_KEYWORDS[urgency].some((k) => hasKeyword(text, k))) return urgency;
  }
  return undefined;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  return digits;
}

/**
 * Deterministic slot extractor. Uses the current known slots to decide which
 * field a bare answer (e.g. just a name, or just an address) should fill.
 */
export class RuleBasedNlu implements NluPort {
  extract(utterance: string, current: BookingSlots): Partial<BookingSlots> {
    const text = utterance.toLowerCase().trim();
    const patch: Partial<BookingSlots> = {};
    if (!text) return patch;

    const phoneMatch = utterance.match(PHONE_RE);
    if (phoneMatch?.[1] && !current.phone) {
      patch.phone = normalizePhone(phoneMatch[1]);
    }

    const trade = detectTrade(text);
    if (trade && !current.trade) patch.trade = trade;

    const urgency = detectUrgency(text);
    if (urgency && !current.urgency) patch.urgency = urgency;

    const nameMatch = utterance.match(/\b(?:my name is|i am|this is|it's|i'm)\s+([a-z][a-z .'-]{1,40})/i);
    if (nameMatch?.[1] && !current.customerName) {
      patch.customerName = nameMatch[1].trim().replace(/\s+/g, ' ');
    }

    const addressMatch = utterance.match(/\b(?:at|address is|live at|i'm at)\s+(\d+[^.?!]*)/i);
    if (addressMatch?.[1] && !current.address) {
      patch.address = addressMatch[1].trim();
    } else if (!current.address && /\b\d+\s+\w+/.test(utterance) && !patch.phone) {
      // A bare "742 Evergreen Terrace" style answer with no phone digits.
      if (/\d{1,5}\s+[a-z]/i.test(utterance) && !PHONE_RE.test(utterance)) {
        patch.address = utterance.trim();
      }
    }

    // Description: if we still need it and nothing structured matched, keep the
    // raw utterance as the problem description.
    const stillNeedsDescription = !current.description && !patch.description;
    const nothingElseMatched =
      !patch.phone && !patch.customerName && !patch.address && Object.keys(patch).length <= 1;
    if (stillNeedsDescription && (trade || (nothingElseMatched && text.length > 8))) {
      patch.description = utterance.trim();
    }

    return patch;
  }
}

/** Prompt the agent should speak next, given the slots collected so far. */
export interface DialogStep {
  readonly done: boolean;
  readonly prompt: string;
  readonly missing: (keyof BookingSlots)[];
}

const PROMPTS: Record<keyof BookingSlots, string> = {
  customerName: 'Can I get your name, please?',
  phone: 'What is the best phone number to reach you?',
  address: 'What is the service address?',
  trade: 'What kind of problem are you having — plumbing, heating and cooling, or electrical?',
  urgency: 'Is this an emergency, or can it wait for a routine visit?',
  description: 'Can you briefly describe what is going on?',
};

/** Pure planner: turns a slot state into the next thing the agent should say. */
export class DialogEngine {
  constructor(private readonly nlu: NluPort = new RuleBasedNlu()) {}

  ingest(utterance: string, slots: BookingSlots): Partial<BookingSlots> {
    return this.nlu.extract(utterance, slots);
  }

  next(slots: BookingSlots): DialogStep {
    const missing = missingSlots(slots);
    if (missing.length === 0) {
      return { done: true, prompt: '', missing };
    }
    const first = missing[0]!;
    return { done: false, prompt: PROMPTS[first], missing };
  }
}
