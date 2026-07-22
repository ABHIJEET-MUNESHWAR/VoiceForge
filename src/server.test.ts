import { describe, it, expect } from 'vitest';
import { createApp } from './server.js';
import { mockProviders } from './providers.js';
import { InMemoryBooking } from './booking.js';
import { MetricsRegistry } from './metrics.js';
import { loadConfig } from './config.js';

function app() {
  return createApp({
    providers: mockProviders(),
    booking: new InMemoryBooking(),
    config: loadConfig({}),
    metrics: new MetricsRegistry(),
  });
}

async function turn(a: ReturnType<typeof app>, id: string, text: string) {
  const res = await a.request(`/calls/${id}/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return res;
}

describe('VoiceForge HTTP API', () => {
  it('reports health', async () => {
    const res = await app().request('/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 'ok' });
  });

  it('runs a full booking call over HTTP', async () => {
    const a = app();
    const start = await a.request('/calls', { method: 'POST' });
    expect(start.status).toBe(201);
    const { callId } = (await start.json()) as { callId: string };

    await turn(a, callId, 'My name is John Carter');
    await turn(a, callId, 'reach me at 555 123 4567');
    await turn(a, callId, "I'm at 742 Evergreen Terrace");
    await turn(a, callId, 'my furnace stopped heating');
    await turn(a, callId, 'today please, it is urgent');
    const done = await turn(a, callId, 'yes book it');
    const body = (await done.json()) as { status: string; confirmation?: { technician: string } };
    expect(body.status).toBe('completed');
    expect(body.confirmation?.technician).toBe('Dane Brooks');

    const snap = await a.request(`/calls/${callId}`);
    const snapshot = (await snap.json()) as { status: string; jobId: string };
    expect(snapshot.status).toBe('completed');
    expect(snapshot.jobId).toBeTruthy();
  });

  it('exposes prometheus metrics', async () => {
    const a = app();
    await a.request('/calls', { method: 'POST' });
    const res = await a.request('/metrics');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/voiceforge_http_requests_total/);
  });

  it('returns 404 for an unknown call', async () => {
    const res = await turn(app(), 'call_missing', 'hi');
    expect(res.status).toBe(404);
  });

  it('rejects a turn without text', async () => {
    const a = app();
    const start = await a.request('/calls', { method: 'POST' });
    const { callId } = (await start.json()) as { callId: string };
    const res = await a.request(`/calls/${callId}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
