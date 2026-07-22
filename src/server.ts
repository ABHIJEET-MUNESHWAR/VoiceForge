import { Hono } from 'hono';
import { z } from 'zod';
import { type Config } from './config.js';
import { CallSession, newCallId } from './domain.js';
import { CallOrchestrator, type OrchestratorDeps } from './orchestrator.js';
import { MetricsRegistry } from './metrics.js';
import { VoiceForgeError } from './errors.js';

const TurnBody = z.object({ text: z.string().min(1) });

function statusFor(error: unknown): number {
  if (error instanceof VoiceForgeError) {
    switch (error.code) {
      case 'INVALID_CALL_STATE':
        return 409;
      case 'TIMEOUT':
        return 504;
      case 'PROVIDER_ERROR':
        return 502;
      default:
        return 400;
    }
  }
  return 500;
}

/**
 * HTTP surface for VoiceForge. A turn is modelled as `POST /calls/:id/turn`
 * with the caller's transcribed text — in production the media stream would be
 * bridged from Twilio, but the domain flow is identical.
 */
export function createApp(deps: OrchestratorDeps & { metrics: MetricsRegistry }): Hono {
  const app = new Hono();
  const orchestrator = new CallOrchestrator(deps);
  const sessions = new Map<string, CallSession>();
  const { metrics } = deps;

  app.use('*', async (c, next) => {
    const start = performance.now();
    await next();
    metrics
      .histogram('voiceforge_http_request_ms', 'HTTP request latency')
      .observe(performance.now() - start, { method: c.req.method, status: String(c.res.status) });
    metrics
      .counter('voiceforge_http_requests_total', 'HTTP requests')
      .inc({ method: c.req.method, status: String(c.res.status) });
  });

  app.get('/health', (c) => c.json({ status: 'ok', provider: deps.config.voiceProvider }));

  app.get('/metrics', (c) => c.text(metrics.expose(), 200, { 'content-type': 'text/plain' }));

  app.post('/calls', async (c) => {
    const session = new CallSession(newCallId());
    sessions.set(session.id, session);
    const turn = await orchestrator.answer(session);
    return c.json(turn, 201);
  });

  app.post('/calls/:id/turn', async (c) => {
    const session = sessions.get(c.req.param('id'));
    if (!session) return c.json({ error: 'call not found' }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const parsed = TurnBody.safeParse(body);
    if (!parsed.success) return c.json({ error: 'text is required' }, 400);
    try {
      const turn = await orchestrator.handleCallerAudio(session, {
        bytes: parsed.data.text.length * 32,
        transcriptHint: parsed.data.text,
      });
      return c.json(turn);
    } catch (error) {
      return c.json({ error: (error as Error).message }, statusFor(error) as 400);
    }
  });

  app.get('/calls/:id', (c) => {
    const session = sessions.get(c.req.param('id'));
    if (!session) return c.json({ error: 'call not found' }, 404);
    return c.json({
      id: session.id,
      status: session.status,
      slots: session.slots,
      turns: session.turns,
      jobId: session.jobId,
      transcript: session.transcript,
    });
  });

  return app;
}

export type { Config };
