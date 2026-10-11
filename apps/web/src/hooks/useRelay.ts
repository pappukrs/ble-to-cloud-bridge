import { useEffect, useRef, useState } from 'react';
import type { ClientRole, Message, ReadingMessage } from '@ble-bridge/shared';
import { WsClient, type WsStatus } from '../ws/client';

export interface UseRelayOptions {
  url: string;
  token: string;
  role: ClientRole;
  /** Injected for tests. */
  WebSocketImpl?: typeof WebSocket;
  maxReadings?: number;
}

/**
 * Owns one WsClient for the lifetime of the component.
 * Readings arrive newest-first, trimmed to maxReadings.
 */
export function useRelay({ url, token, role, WebSocketImpl, maxReadings = 50 }: UseRelayOptions) {
  const [status, setStatus] = useState<WsStatus>('closed');
  const [peers, setPeers] = useState<number | null>(null);
  const [readings, setReadings] = useState<ReadingMessage[]>([]);
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const onMessage = (m: Message) => {
      if (m.type === 'reading') {
        setReadings((prev) => [m, ...prev].slice(0, maxReadings));
      } else if (m.type === 'welcome') {
        setPeers(m.peers);
      }
    };
    const client = new WsClient({
      url,
      token,
      role,
      onMessage,
      onStatus: setStatus,
      ...(WebSocketImpl ? { WebSocketImpl } : {}),
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [url, token, role, WebSocketImpl, maxReadings]);

  const sendReading = (reading: ReadingMessage) => {
    clientRef.current?.sendReading(reading);
    setReadings((prev) => [reading, ...prev].slice(0, maxReadings));
  };

  return { status, peers, readings, sendReading };
}
