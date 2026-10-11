import { useState } from 'react';
import { BridgePage } from './pages/BridgePage';
import { DashboardPage } from './pages/DashboardPage';
import { ChatPage } from './pages/ChatPage';
import { WS_URL, WS_TOKEN } from './config';

type Page = 'bridge' | 'dashboard' | 'chat';

function initialPage(): Page {
  const hash = window.location.hash.replace('#', '');
  return hash === 'dashboard' || hash === 'chat' ? hash : 'bridge';
}

/**
 * Both pages stay mounted and only the inactive one is hidden.
 * Unmounting the bridge would drop its relay socket while the BLE link
 * stays open, so readings would silently stop flowing.
 */
export function App() {
  const [page, setPage] = useState<Page>(initialPage);
  const go = (p: Page) => {
    window.location.hash = p;
    setPage(p);
  };
  return (
    <main>
      <header>
        <h1>BLE to Cloud Bridge</h1>
        <nav>
          <button aria-pressed={page === 'bridge'} onClick={() => go('bridge')}>
            Bridge
          </button>
          <button aria-pressed={page === 'dashboard'} onClick={() => go('dashboard')}>
            Dashboard
          </button>
          <button aria-pressed={page === 'chat'} onClick={() => go('chat')}>
            Chat
          </button>
        </nav>
      </header>
      <div hidden={page !== 'bridge'}>
        <BridgePage wsUrl={WS_URL} wsToken={WS_TOKEN} />
      </div>
      <div hidden={page !== 'dashboard'}>
        <DashboardPage wsUrl={WS_URL} wsToken={WS_TOKEN} />
      </div>
      <div hidden={page !== 'chat'}>
        <ChatPage />
      </div>
      <footer className="muted">Relay: {WS_URL}</footer>
    </main>
  );
}
