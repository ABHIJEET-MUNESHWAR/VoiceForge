import { serve } from '@hono/node-server';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createApp } from './server.js';
import { InMemoryBooking } from './booking.js';
import { liveProviders, mockProviders } from './providers.js';
import { metrics } from './metrics.js';

const config = loadConfig();
const logger = pino({ level: config.logLevel });

const providers =
  config.voiceProvider === 'live'
    ? liveProviders({
        deepgramApiKey: process.env.DEEPGRAM_API_KEY,
        elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
        twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
        twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
      })
    : mockProviders();

const app = createApp({ providers, booking: new InMemoryBooking(), config, metrics });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info({ port: info.port, provider: config.voiceProvider }, 'VoiceForge listening');
});
