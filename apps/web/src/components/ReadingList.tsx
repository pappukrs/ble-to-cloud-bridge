import type { ReadingMessage } from '@ble-bridge/shared';

export interface ReadingListProps {
  readings: ReadingMessage[];
  emptyText?: string;
}

export function ReadingList({ readings, emptyText = 'No readings yet.' }: ReadingListProps) {
  if (readings.length === 0) return <p className="muted">{emptyText}</p>;
  const latest = readings[0]!;
  return (
    <div>
      <div className="latest" data-testid="latest-value">
        {latest.value}
      </div>
      <ul className="log" aria-label="reading log">
        {readings.map((r, i) => (
          <li key={`${r.ts}-${i}`}>
            <time dateTime={new Date(r.ts).toISOString()}>
              {new Date(r.ts).toLocaleTimeString()}
            </time>{' '}
            {r.deviceName ? <span className="muted">{r.deviceName} </span> : null}
            <code>{r.value}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
