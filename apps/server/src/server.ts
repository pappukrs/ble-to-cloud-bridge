import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { parseMessage, serializeMessage, type ErrorMessage } from '@ble-bridge/shared';
import type { ServerConfig } from './config';
import { isAuthorized } from './auth';
import { Relay, type RelaySocket } from './relay';

export interface RunningServer {
  http: HttpServer;
  wss: WebSocketServer;
  relay: Relay;
  port: number;
  close(): Promise<void>;
}

function wrap(ws: WebSocket): RelaySocket {
  return {
    get isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
  };
}

function sendError(ws: WebSocket, code: ErrorMessage['code'], detail?: string): void {
  const msg: ErrorMessage = detail ? { type: 'error', code, detail } : { type: 'error', code };
  ws.send(serializeMessage(msg));
}

/**
 * Start an HTTP server with a WebSocket endpoint on it.
 * Protocol:
 *   1. client connects
 *   2. client must send {type:"hello", role, token} within helloTimeoutMs
 *   3. server replies {type:"welcome", clientId, peers}
 *   4. any later {type:"reading"} is broadcast to all other peers
 */
export function startServer(config: ServerConfig): Promise<RunningServer> {
  const http = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ble-bridge relay ok\n');
  });
  const wss = new WebSocketServer({ server: http, maxPayload: config.maxPayloadBytes });
  const relay = new Relay();

  wss.on('connection', (ws) => {
    let peerId: string | null = null;

    const helloTimer = setTimeout(() => {
      if (peerId === null) ws.close(4001, 'hello timeout');
    }, config.helloTimeoutMs);

    ws.on('message', (data) => {
      const parsed = parseMessage(data.toString());
      if (!parsed.ok) {
        sendError(ws, 'invalid_message', parsed.reason);
        return;
      }
      const msg = parsed.message;

      if (peerId === null) {
        if (msg.type !== 'hello') {
          sendError(ws, 'unauthorized', 'first message must be hello');
          ws.close(4001, 'hello required');
          return;
        }
        if (!isAuthorized(msg.token, config.authToken)) {
          sendError(ws, 'unauthorized', 'bad token');
          ws.close(4003, 'unauthorized');
          return;
        }
        clearTimeout(helloTimer);
        const peer = relay.add(msg.role, wrap(ws));
        peerId = peer.id;
        ws.send(serializeMessage({ type: 'welcome', clientId: peer.id, peers: relay.size() - 1 }));
        return;
      }

      if (msg.type === 'reading') {
        relay.broadcast(peerId, msg);
      }
      // hello after welcome, or client-sent welcome/error frames, are ignored on purpose
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (peerId !== null) relay.remove(peerId);
    });

    ws.on('error', () => {
      // 'close' follows an error; cleanup happens there
    });
  });

  return new Promise((resolve) => {
    http.listen(config.port, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : config.port;
      resolve({
        http,
        wss,
        relay,
        port,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => http.close(() => done()));
          }),
      });
    });
  });
}
