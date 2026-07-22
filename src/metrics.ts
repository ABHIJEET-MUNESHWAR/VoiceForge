/**
 * Dependency-free metrics registry with Prometheus text-exposition output.
 * Supports counters (monotonic) and histograms (latency buckets) so voice
 * turn latency — the metric that matters most for perceived responsiveness —
 * can be tracked without pulling in a heavy client library.
 */

type Labels = Readonly<Record<string, string>>;

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}="${labels[k]}"`).join(',');
}

class Counter {
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, delta = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + delta);
  }

  get(labels: Labels = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }

  expose(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    }
    for (const [key, value] of this.values) {
      lines.push(key ? `${this.name}{${key}} ${value}` : `${this.name} ${value}`);
    }
    return lines.join('\n');
  }
}

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];

class Histogram {
  private readonly counts = new Map<string, number[]>();
  private readonly sums = new Map<string, number>();
  private readonly totals = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: readonly number[] = DEFAULT_BUCKETS,
  ) {}

  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    const counts = this.counts.get(key) ?? this.buckets.map(() => 0);
    for (let i = 0; i < this.buckets.length; i += 1) {
      const bound = this.buckets[i];
      if (bound !== undefined && value <= bound) counts[i] = (counts[i] ?? 0) + 1;
    }
    this.counts.set(key, counts);
    this.sums.set(key, (this.sums.get(key) ?? 0) + value);
    this.totals.set(key, (this.totals.get(key) ?? 0) + 1);
  }

  expose(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, counts] of this.counts) {
      const prefix = key ? `${this.name}_bucket{${key},le=` : `${this.name}_bucket{le=`;
      for (let i = 0; i < this.buckets.length; i += 1) {
        lines.push(`${prefix}"${this.buckets[i]}"} ${counts[i] ?? 0}`);
      }
      const total = this.totals.get(key) ?? 0;
      lines.push(`${prefix}"+Inf"} ${total}`);
      const inner = key ? `{${key}}` : '';
      lines.push(`${this.name}_sum${inner} ${this.sums.get(key) ?? 0}`);
      lines.push(`${this.name}_count${inner} ${total}`);
    }
    return lines.join('\n');
  }
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  counter(name: string, help: string): Counter {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name, help);
      this.counters.set(name, c);
    }
    return c;
  }

  histogram(name: string, help: string, buckets?: readonly number[]): Histogram {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, help, buckets);
      this.histograms.set(name, h);
    }
    return h;
  }

  /** Time an async operation and record it into the named histogram. */
  async time<T>(name: string, help: string, labels: Labels, op: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await op();
    } finally {
      this.histogram(name, help).observe(performance.now() - start, labels);
    }
  }

  expose(): string {
    const blocks: string[] = [];
    for (const c of this.counters.values()) blocks.push(c.expose());
    for (const h of this.histograms.values()) blocks.push(h.expose());
    return `${blocks.join('\n\n')}\n`;
  }
}

export const metrics = new MetricsRegistry();
