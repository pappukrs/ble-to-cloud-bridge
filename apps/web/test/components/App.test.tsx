import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App';

const heading = (name: string) => screen.getByRole('heading', { name, hidden: true });

beforeEach(() => {
  window.location.hash = '';
});

describe('App', () => {
  it('keeps the bridge mounted while showing the dashboard', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(heading('Bridge')).toBeVisible();
    expect(heading('Dashboard')).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Dashboard' }));

    expect(heading('Dashboard')).toBeVisible();
    expect(heading('Bridge')).not.toBeVisible();
    expect(heading('Bridge')).toBeInTheDocument();
    expect(window.location.hash).toBe('#dashboard');
  });
});
