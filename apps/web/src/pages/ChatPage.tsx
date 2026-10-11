import { useEffect, useRef, useState } from 'react';
import { isBluetoothAvailable } from '../ble/client';
import { connectChat, type ChatLink } from '../ble/chat';

export interface ChatMessage {
  from: 'me' | 'peer';
  text: string;
  ts: number;
}

export interface ChatPageProps {
  /** Injected for tests. */
  bluetooth?: Bluetooth;
  now?: () => number;
}

/**
 * Bluetooth-only chat. Runs on the phone as the central; the laptop runs
 * apps/peripheral. No network is used at any point.
 */
export function ChatPage({ bluetooth, now = Date.now }: ChatPageProps) {
  const [link, setLink] = useState<ChatLink | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLUListElement>(null);

  const available = bluetooth ? true : isBluetoothAvailable();

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  const push = (from: ChatMessage['from'], text: string) =>
    setMessages((prev) => [...prev, { from, text, ts: now() }]);

  const onConnect = async () => {
    setError(null);
    try {
      const chat = await connectChat({
        ...(bluetooth ? { bluetooth } : {}),
        onMessage: (text) => push('peer', text),
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
      await link.send(text);
      push('me', text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <section>
      <h2>Chat</h2>
      <p className="muted">Phone to laptop over Bluetooth only. No network involved.</p>

      <div className="row">
        {link ? (
          <>
            <span>
              Connected to <strong>{link.peerName ?? 'laptop'}</strong>
            </span>
            <button onClick={() => link.disconnect()}>Disconnect</button>
          </>
        ) : (
          <button onClick={onConnect} disabled={!available}>
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
          <li key={`${m.ts}-${i}`} className={`bubble bubble-${m.from}`}>
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
