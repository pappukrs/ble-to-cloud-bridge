import {
  parseMessage,
  serializeMessage,
  type ClientRole,
  type Message,
  type ReadingMessage,
} from '@ble-bridge/shared';

export type WsStatus = 'connecting' | 'open' | 'closed' | 'unauthorized';

export interface WsClientOptions {
  url: string;
  token: string;
  role: ClientRole;
  onMessage: (message: Message) => void;
  onStatus?: (status: WsStatus) => void;
  /** Injected for tests. Defaults to the browser's WebSocket. */
  WebSocketImpl?: typeof WebSocket;
  /** Injected for tests. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => unknown;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

/** Close codes on which reconnecting is pointless. Must match apps/server. */
const NO_RETRY_CODES = new Set([4003]);

/**
 * Browser-side relay client.
 *  - sends the hello frame as soon as the socket opens
 *  - queues readings while disconnected and flushes on welcome
 *  - reconnects with exponential backoff, except after an auth failure
 */
export class WsClient {
  private socket: WebSocket | null = null;
  private queue: ReadingMessage[] = [];
  private backoffMs: number;
  private stopped = false;
  private welcomed = false;
  private readonly WS: typeof WebSocket;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  status: WsStatus = 'closed';

  constructor(private readonly options: WsClientOptions) {
    this.WS = options.WebSocketImpl ?? WebSocket;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.minBackoff = options.minBackoffMs ?? 500;
    this.maxBackoff = options.maxBackoffMs ?? 10_000;
    this.backoffMs = this.minBackoff;
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  /** Send a reading now, or queue it until the server has welcomed us. */
  sendReading(reading: ReadingMessage): void {
    if (this.socket && this.socket.readyState === this.WS.OPEN && this.welcomed) {
      this.socket.send(serializeMessage(reading));
    } else {
      this.queue.push(reading);
    }
  }

  get queued(): number {
    return this.queue.length;
  }

  close(): void {
    this.stopped = true;
    this.socket?.close(1000, 'client closed');
    this.socket = null;
    this.setStatus('closed');
  }

  private setStatus(status: WsStatus): void {
    this.status = status;
    this.options.onStatus?.(status);
  }

  private open(): void {
    this.setStatus('connecting');
    this.welcomed = false;
    const socket = new this.WS(this.options.url);
    this.socket = socket;

    socket.onopen = () => {
      socket.send(
        serializeMessage({ type: 'hello', role: this.options.role, token: this.options.token }),
      );
    };

    socket.onmessage = (event: MessageEvent) => {
      const parsed = parseMessage(String(event.data));
      if (!parsed.ok) return;
      const message = parsed.message;
      if (message.type === 'welcome') {
        this.welcomed = true;
        this.backoffMs = this.minBackoff;
        this.setStatus('open');
        this.flush();
      }
      this.options.onMessage(message);
    };

    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return; // stale socket from before a close()
      this.socket = null;
      this.welcomed = false;
      if (NO_RETRY_CODES.has(event.code)) {
        this.setStatus('unauthorized');
        return;
      }
      this.setStatus('closed');
      if (!this.stopped) this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose always follows onerror in browsers; reconnect is handled there.
    };
  }

  private flush(): void {
    if (!this.socket) return;
    for (const reading of this.queue) this.socket.send(serializeMessage(reading));
    this.queue = [];
  }

  private scheduleReconnect(): void {
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoff);
    this.schedule(() => {
      if (!this.stopped) this.open();
    }, delay);
  }
}
