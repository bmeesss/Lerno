import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTheme } from './useTheme';

function Toggle({ name }: { name: string }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme}>
      {name}: {theme}
    </button>
  );
}
beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = 'light';
});

describe('shared appearance preference', () => {
  it('starts in light mode and synchronizes all mounted toggles', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Toggle name="Sidebar" />
        <Toggle name="Settings" />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Sidebar: light' }));
    expect(screen.getByRole('button', { name: 'Settings: dark' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('lerno.theme')).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Settings: dark' }));
    expect(screen.getByRole('button', { name: 'Sidebar: light' })).toBeInTheDocument();
  });
  it('retains an existing dark preference', () => {
    localStorage.setItem('lerno.theme', 'dark');
    render(<Toggle name="Appearance" />);
    expect(screen.getByRole('button', { name: 'Appearance: dark' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
