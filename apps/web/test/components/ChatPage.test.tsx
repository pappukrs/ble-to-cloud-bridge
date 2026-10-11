import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { encodeChunks } from '@ble-bridge/shared';
import { ChatPage } from '../../src/pages/ChatPage';
import { FakeChatDevice } from '../ble/fakeChatDevice';

describe('ChatPage', () => {
  it('connects, sends a message, and shows it as mine', async () => {
    const user = userEvent.setup();
    const dev = new FakeChatDevice('ble-chat');
    render(<ChatPage bluetooth={dev.bluetooth()} now={() => 1000} />);

    await user.click(screen.getByRole('button', { name: 'Connect to laptop' }));
    expect(screen.getByText(/Connected to/)).toHaveTextContent('ble-chat');

    await user.type(screen.getByLabelText('message'), 'hello laptop');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(dev.written).toHaveLength(1);
    const items = screen.getByRole('list', { name: 'chat messages' }).children;
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveClass('bubble-me');
    expect(items[0]).toHaveTextContent('hello laptop');
    expect(screen.getByLabelText('message')).toHaveValue('');
  });

  it('shows incoming messages from the laptop', async () => {
    const user = userEvent.setup();
    const dev = new FakeChatDevice();
    render(<ChatPage bluetooth={dev.bluetooth()} />);
    await user.click(screen.getByRole('button', { name: 'Connect to laptop' }));

    act(() => {
      for (const c of encodeChunks('hi phone', 3)) dev.notifyChunk(c);
    });

    const items = screen.getByRole('list', { name: 'chat messages' }).children;
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveClass('bubble-peer');
    expect(items[0]).toHaveTextContent('hi phone');
  });

  it('disables input until connected and explains when Bluetooth is missing', () => {
    render(<ChatPage />);
    expect(screen.getByRole('button', { name: 'Connect to laptop' })).toBeDisabled();
    expect(screen.getByLabelText('message')).toBeDisabled();
    expect(screen.getByText(/Web Bluetooth is not available/)).toBeInTheDocument();
  });

  it('returns to the connect button when the laptop disconnects', async () => {
    const user = userEvent.setup();
    const dev = new FakeChatDevice();
    render(<ChatPage bluetooth={dev.bluetooth()} />);
    await user.click(screen.getByRole('button', { name: 'Connect to laptop' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByRole('button', { name: 'Connect to laptop' })).toBeInTheDocument();
  });
});
