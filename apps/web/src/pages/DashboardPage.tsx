import { useRelay } from '../hooks/useRelay';
import { StatusBadge } from '../components/StatusBadge';
import { ReadingList } from '../components/ReadingList';

export interface DashboardPageProps {
  wsUrl: string;
  wsToken: string;
  /** Injected for tests. */
  WebSocketImpl?: typeof WebSocket;
}

/** Runs anywhere. Only listens. */
export function DashboardPage({ wsUrl, wsToken, WebSocketImpl }: DashboardPageProps) {
  const relay = useRelay({
    url: wsUrl,
    token: wsToken,
    role: 'dashboard',
    ...(WebSocketImpl ? { WebSocketImpl } : {}),
  });
  return (
    <section>
      <h2>Dashboard</h2>
      <p className="muted">Live values relayed from the bridge. Open this on any device.</p>
      <StatusBadge status={relay.status} />
      <h3>Live readings</h3>
      <ReadingList readings={relay.readings} emptyText="Waiting for the bridge to send a value…" />
    </section>
  );
}
