import { BookingError } from './errors.js';
import { type BookingIntent, type Trade } from './domain.js';

export interface BookingConfirmation {
  readonly jobId: string;
  readonly technician: string;
  readonly etaMinutes: number;
}

/**
 * Booking port. In production this adapter would call the ServiceTitan CRM
 * (mirroring the ServiceAgent project). The in-memory implementation lets the
 * whole voice flow run and be tested end-to-end offline.
 */
export interface BookingPort {
  book(intent: BookingIntent): Promise<BookingConfirmation>;
}

interface Technician {
  readonly name: string;
  readonly trades: readonly Trade[];
}

const DEFAULT_TECHNICIANS: readonly Technician[] = [
  { name: 'Amy Rivera', trades: ['plumbing', 'general'] },
  { name: 'Dane Brooks', trades: ['hvac', 'general'] },
  { name: 'Sean Patel', trades: ['electrical'] },
  { name: 'Mark Lowe', trades: ['roofing', 'general'] },
];

const ETA_BY_URGENCY: Record<BookingIntent['urgency'], number> = {
  emergency: 45,
  urgent: 120,
  routine: 1440,
};

let jobSeq = 0;

export class InMemoryBooking implements BookingPort {
  readonly jobs: (BookingConfirmation & { intent: BookingIntent })[] = [];

  constructor(private readonly technicians: readonly Technician[] = DEFAULT_TECHNICIANS) {}

  async book(intent: BookingIntent): Promise<BookingConfirmation> {
    const tech = this.technicians.find((t) => t.trades.includes(intent.trade));
    if (!tech) {
      throw new BookingError(`No technician available for ${intent.trade}`, false);
    }
    jobSeq += 1;
    const confirmation: BookingConfirmation = {
      jobId: `job_${Date.now().toString(36)}${jobSeq.toString(36)}`,
      technician: tech.name,
      etaMinutes: ETA_BY_URGENCY[intent.urgency],
    };
    this.jobs.push({ ...confirmation, intent });
    return confirmation;
  }
}
