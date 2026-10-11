import { useEffect, useRef, useState } from 'react';
import { newParticipantId, type ChatEnvelope } from '@ble-bridge/shared';
import { isBluetoothAvailable } from '../ble/client';
import { connectChat, type ChatLink } from '../ble/chat';

export interface ChatPageProps {
  /** Injected for tests. */
  bluetooth?: Bluetooth;
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

const NAME_KEY = 'ble-chat.name';
const ID_KEY = 'ble-chat.id';

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
  }
}

/**
 * Bluetooth-only group chat. Runs on the phone as a central; the laptop runs
 * apps/peripheral as the hub. No network is used at any point.
 */
export function ChatPage({ bluetooth, now = Date.now, storage }: ChatPageProps) {
  const store = useRef(storage ?? safeStorage()).current;
  const [id] = useState(() => {
    const existing = store.getItem(ID_KEY);
    if (existing) return existing;
    const fresh = newParticipantId();
    store.setItem(ID_KEY, fresh);
    return fresh;
  });
  const [name, setName] = useState(() => store.getItem(NAME_KEY) ?? '');
  const [link, setLink] = useState<ChatLink | null>(null);
  const [messages, setMessages] = useState<ChatEnvelope[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLUListElement>(null);

  const available = bluetooth ? true : isBluetoothAvailable();
  const nameOk = name.trim().length > 0;

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  useEffect(() => {
    store.setItem(NAME_KEY, name);
  }, [name, store]);

  const push = (envelope: ChatEnvelope) => setMessages((prev) => [...prev, envelope]);

  const onConnect = async () => {
    setError(null);
    try {
      const chat = await connectChat({
        id,
        name: name.trim(),
        now,
        ...(bluetooth ? { bluetooth } : {}),
        onMessage: push,
        onDisconnect: () => setLink(null),
      });
      setLink(chat);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onSend = async () => {
    if (!link || !draft.trim() || sending) return;
    const text = draft;
    setDraft('');
    setSending(true);
    try {
      push(await link.send(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <section>
      <h2>Chat</h2>
      <p className="muted">Everyone connects to one laptop over Bluetooth. No network involved.</p>

      <div className="row">
        <input
          aria-label="your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={24}
          disabled={link !== null}
        />
        {link ? (
          <>
            <span>
              Connected to <strong>{link.peerName ?? 'laptop'}</strong>
            </span>
            <button onClick={() => link.disconnect()}>Disconnect</button>
          </>
        ) : (
          <button onClick={onConnect} disabled={!available || !nameOk}>
            Connect to laptop
          </button>
        )}
      </div>
      {!available ? (
        <p className="error">
          Web Bluetooth is not available here. Open this page in Chrome over https:// or localhost.
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      <ul className="chat" aria-label="chat messages" ref={logRef}>
        {messages.map((m, i) => (
          <li
            key={`${m.id}-${m.ts}-${i}`}
            className={`bubble bubble-${m.id === id ? 'me' : 'peer'}`}
          >
            {m.id !== id ? <span className="who">{m.from}</span> : null}
            <span>{m.text}</span>
            <time dateTime={new Date(m.ts).toISOString()}>
              {new Date(m.ts).toLocaleTimeString()}
            </time>
          </li>
        ))}
      </ul>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void onSend();
        }}
      >
        <input
          aria-label="message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={link ? 'Type a message' : 'Connect first'}
          disabled={!link}
        />
        <button type="submit" disabled={!link || !draft.trim() || sending}>
          Send
        </button>
      </form>
    </section>
  );
}
