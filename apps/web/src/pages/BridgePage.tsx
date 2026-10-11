import { useState } from 'react';
import { connectBle, isBluetoothAvailable, type BleConnection } from '../ble/client';
import { useRelay } from '../hooks/useRelay';
import { StatusBadge } from '../components/StatusBadge';
import { ReadingList } from '../components/ReadingList';

export interface BridgePageProps {
  wsUrl: string;
  wsToken: string;
  /** Injected for tests. */
  bluetooth?: Bluetooth;
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Runs on the laptop next to the phone.
 * BLE notify -> sendReading -> relay -> every dashboard.
 */
export function BridgePage({ wsUrl, wsToken, bluetooth, WebSocketImpl }: BridgePageProps) {
  const relay = useRelay({
    url: wsUrl,
    token: wsToken,
    role: 'bridge',
    ...(WebSocketImpl ? { WebSocketImpl } : {}),
  });
  const [ble, setBle] = useState<BleConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outgoing, setOutgoing] = useState('');

  const available = bluetooth ? true : isBluetoothAvailable();

  const onConnect = async () => {
    setError(null);
    try {
      const conn = await connectBle({
        ...(bluetooth ? { bluetooth } : {}),
        onReading: (r) =>
          relay.sendReading({
            type: 'reading',
            source: 'ble',
            value: r.value,
            ts: r.ts,
            ...(r.deviceName ? { deviceName: r.deviceName } : {}),
          }),
        onDisconnect: () => setBle(null),
      });
      setBle(conn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onWrite = async () => {
    if (!ble || !outgoing) return;
    await ble.write(outgoing);
    setOutgoing('');
  };

  return (
    <section>
      <h2>Bridge</h2>
      <p className="muted">Pairs with the phone over BLE and forwards every value to the relay.</p>
      <StatusBadge status={relay.status} />
      {relay.peers !== null ? <span className="muted"> · {relay.peers} peers</span> : null}

      <div className="row">
        {ble ? (
          <>
            <span>
              BLE: connected to <strong>{ble.deviceName ?? 'unnamed device'}</strong>
            </span>
            <button onClick={() => ble.disconnect()}>Disconnect BLE</button>
          </>
        ) : (
          <button onClick={onConnect} disabled={!available}>
            Connect BLE
          </button>
        )}
      </div>
      {!available ? (
        <p className="error">
          Web Bluetooth is not available here. Use Chrome or Edge over https:// or localhost.
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      {ble ? (
        <div className="row">
          <input
            aria-label="value to write"
            value={outgoing}
            onChange={(e) => setOutgoing(e.target.value)}
            placeholder="Write a value to the phone"
          />
          <button onClick={onWrite} disabled={!outgoing}>
            Write
          </button>
        </div>
      ) : null}

      <h3>Readings sent</h3>
      <ReadingList readings={relay.readings} emptyText="Connect BLE to start receiving values." />
    </section>
  );
}
