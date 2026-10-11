import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { encodeChunks, encodeEnvelope } from '@ble-bridge/shared';
import { ChatPage } from '../../src/pages/ChatPage';
import { FakeChatDevice } from '../ble/fakeChatDevice';

function memStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  };
}

describe('ChatPage', () => {
  it('requires a name before connecting and remembers it', async () => {
    const user = userEvent.setup();
    const storage = memStorage();
    render(<ChatPage bluetooth={new FakeChatDevice().bluetooth()} storage={storage} />);
    expect(screen.getByRole('button', { name: 'Connect to laptop' })).toBeDisabled();
    await user.type(screen.getByLabelText('your name'), 'Asha');
    expect(screen.getByRole('button', { name: 'Connect to laptop' })).toBeEnabled();
    expect(storage.map.get('ble-chat.name')).toBe('Asha');
    expect(storage.map.get('ble-chat.id')).toMatch(/^[a-z0-9]{8}$/);
  });

  it('connects, sends a message, and shows it as mine', async () => {
    const user = userEvent.setup();
    const dev = new FakeChatDevice('ble-chat');
    render(
      <ChatPage
        bluetooth={dev.bluetooth()}
        now={() => 1000}
        storage={memStorage({ 'ble-chat.name': 'Asha' })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Connect to laptop' }));
    expect(screen.getByText(/Connected to/)).toHaveTextContent('ble-chat');

    await user.type(screen.getByLabelText('message'), 'hello laptop');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(dev.written.length).toBeGreaterThan(0);
    const items = screen.getByRole('list', { name: 'chat messages' }).children;
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveClass('bubble-me');
    expect(items[0]).toHaveTextContent('hello laptop');
    expect(screen.getByLabelText('message')).toHaveValue('');
  });

  it('shows incoming messages from others with their name', async () => {
    const user = userEvent.setup();
    const dev = new FakeChatDevice();
    render(
      <ChatPage bluetooth={dev.bluetooth()} storage={memStorage({ 'ble-chat.name': 'Asha' })} />,
    );
    await user.click(screen.getByRole('button', { name: 'Connect to laptop' }));

    act(() => {
      const env = { id: 'p2', from: 'Ravi', text: 'hi phone', ts: 5 };
      for (const c of encodeChunks(encodeEnvelope(env), 3)) dev.notifyChunk(c);
    });

    const items = screen.getByRole('list', { name: 'chat messages' }).children;
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveClass('bubble-peer');
    expect(items[0]).toHaveTextContent('Ravi');
    expect(items[0]).toHaveTextContent('hi phone');
  });

  it('disables input until connected and explains when Bluetooth is missing', () => {
    render(<ChatPage storage={memStorage()} />);
    expect(screen.getByRole('button', { name: 'Connect to laptop' })).toBeDisabled();
    expect(screen.getByLabelText('message')).toBeDisabled();
    expect(screen.getByText(/Web Bluetooth is not available/)).toBeInTheDocument();
  });

  it('returns to the connect button when the laptop disconnects', async () => {
    const user = userEvent.setup();
    const dev = new FakeChatDevice();
    render(
      <ChatPage bluetooth={dev.bluetooth()} storage={memStorage({ 'ble-chat.name': 'Asha' })} />,
    );
    await user.click(screen.getByRole('button', { name: 'Connect to laptop' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByRole('button', { name: 'Connect to laptop' })).toBeInTheDocument();
  });
});
