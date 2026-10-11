import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { parseMessage, type Message } from '@ble-bridge/shared';
import { startServer, type RunningServer } from '../src/server';

const TOKEN = 'test-token';
let server: RunningServer;

beforeEach(async () => {
  server = await startServer({
    port: 0,
    authToken: TOKEN,
    maxPayloadBytes: 256,
    helloTimeoutMs: 200,
  });
});

afterEach(async () => {
  await server.close();
});

/** Open a socket and resolve once it is connected. */
function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Resolve with the next parsed message the socket receives. */
function nextMessage(ws: WebSocket): Promise<Message> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => {
      const parsed = parseMessage(data.toString());
      if (parsed.ok) resolve(parsed.message);
      else reject(new Error(parsed.reason));
    });
  });
}

/** Resolve with the close code once the socket closes. */
function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

async function join(role: 'bridge' | 'dashboard'): Promise<WebSocket> {
  const ws = await connect();
  const welcome = nextMessage(ws);
  ws.send(JSON.stringify({ type: 'hello', role, token: TOKEN }));
  const msg = await welcome;
  expect(msg.type).toBe('welcome');
  return ws;
}

describe('relay server', () => {
  it('answers HTTP GET with a health line', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('ok');
  });

  it('welcomes a client with a valid hello and reports peer count', async () => {
    const a = await connect();
    const welcomeA = nextMessage(a);
    a.send(JSON.stringify({ type: 'hello', role: 'bridge', token: TOKEN }));
    expect(await welcomeA).toEqual({ type: 'welcome', clientId: 'c1', peers: 0 });

    const b = await join('dashboard');
    expect(server.relay.size()).toBe(2);
    a.close();
    b.close();
  });

  it('closes with 4003 on a wrong token', async () => {
    const ws = await connect();
    const err = nextMessage(ws);
    const code = closed(ws);
    ws.send(JSON.stringify({ type: 'hello', role: 'bridge', token: 'nope' }));
    expect(await err).toMatchObject({ type: 'error', code: 'unauthorized' });
    expect(await code).toBe(4003);
  });

  it('closes with 4001 if the first message is not a hello', async () => {
    const ws = await connect();
    const code = closed(ws);
    ws.send(JSON.stringify({ type: 'reading', source: 'ble', value: '1', ts: 1 }));
    expect(await code).toBe(4001);
  });

  it('closes with 4001 if no hello arrives before the timeout', async () => {
    const ws = await connect();
    expect(await closed(ws)).toBe(4001);
  });

  it('broadcasts a reading from the bridge to every dashboard but not back to the bridge', async () => {
    const bridge = await join('bridge');
    const d1 = await join('dashboard');
    const d2 = await join('dashboard');

    const got1 = nextMessage(d1);
    const got2 = nextMessage(d2);
    let bridgeGotEcho = false;
    bridge.once('message', () => (bridgeGotEcho = true));

    const reading = { type: 'reading', source: 'ble', value: '42', ts: 123 };
    bridge.send(JSON.stringify(reading));

    expect(await got1).toEqual(reading);
    expect(await got2).toEqual(reading);
    await new Promise((r) => setTimeout(r, 50));
    expect(bridgeGotEcho).toBe(false);

    bridge.close();
    d1.close();
    d2.close();
  });

  it('replies with invalid_message on bad JSON and keeps the socket open', async () => {
    const ws = await join('bridge');
    const err = nextMessage(ws);
    ws.send('{oops');
    expect(await err).toMatchObject({ type: 'error', code: 'invalid_message' });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('drops the connection when a frame exceeds maxPayload', async () => {
    const ws = await join('bridge');
    const code = closed(ws);
    ws.send('x'.repeat(1000));
    expect(await code).toBe(1009);
  });

  it('removes a peer from the relay when it disconnects', async () => {
    const ws = await join('bridge');
    expect(server.relay.size()).toBe(1);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.relay.size()).toBe(0);
  });
});
