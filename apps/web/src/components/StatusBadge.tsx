import type { WsStatus } from '../ws/client';

const LABELS: Record<WsStatus, string> = {
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Disconnected',
  unauthorized: 'Unauthorized (check token)',
};

export function StatusBadge({ status }: { status: WsStatus }) {
  return (
    <span className={`badge badge-${status}`} role="status" aria-live="polite">
      Relay: {LABELS[status]}
    </span>
  );
}
