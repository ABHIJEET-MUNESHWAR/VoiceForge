import { z } from 'zod';

/**
 * Environment-driven configuration validated at the boundary with Zod.
 * Defaults keep the service fully runnable offline (mock providers), while
 * production wiring is enabled purely through environment variables.
 */
const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(4100),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Which speech/telephony stack to use. `mock` requires no network. */
  voiceProvider: z.enum(['mock', 'live']).default('mock'),
  /** Latency budget for a single STT or TTS call. */
  turnTimeoutMs: z.coerce.number().int().positive().default(2500),
  /** Maximum caller turns before the agent escalates to a human. */
  maxTurns: z.coerce.number().int().positive().default(12),
  agentName: z.string().default('Ivy'),
  companyName: z.string().default('BrightHome Services'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    voiceProvider: env.VOICE_PROVIDER,
    turnTimeoutMs: env.TURN_TIMEOUT_MS,
    maxTurns: env.MAX_TURNS,
    agentName: env.AGENT_NAME,
    companyName: env.COMPANY_NAME,
  });
}
