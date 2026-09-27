import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui/Toast';
import type { AuthUser } from '../types';
import { SettingsPage } from './SettingsPage';

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: {
    user: null as AuthUser | null,
    logout: vi.fn(),
    updateProfile: vi.fn(),
  },
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => mockAuth,
}));
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}));

function renderPage() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.user = {
    id: 'u1',
    email: 'student@example.com',
    profile: {
      id: 'u1',
      displayName: 'Student',
      avatarUrl: null,
      role: 'user',
      timezone: 'UTC',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };
  mockAuth.updateProfile.mockResolvedValue(mockAuth.user.profile);
});

describe('SettingsPage time zone', () => {
  it('shows the stored time zone and saves changes', async () => {
    const user = userEvent.setup();
    renderPage();
    const select = screen.getByLabelText('Time zone') as HTMLSelectElement;
    expect(select.value).toBe('UTC');

    await user.selectOptions(select, 'Europe/Amsterdam');
    expect(mockAuth.updateProfile).toHaveBeenCalledWith({ timezone: 'Europe/Amsterdam' });
    expect(await screen.findByText('Time zone saved')).toBeInTheDocument();
  });

  it('shows an error toast when saving fails', async () => {
    const user = userEvent.setup();
    mockAuth.updateProfile.mockRejectedValue(new Error('offline'));
    renderPage();
    await user.selectOptions(screen.getByLabelText('Time zone'), 'Asia/Tokyo');
    expect(await screen.findByText(/could not save your time zone/i)).toBeInTheDocument();
  });
});
