import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { profile: { displayName: 'Sam Student', role: 'user' } },
    logout: vi.fn(),
  }),
}));

function renderShell(path = '/dashboard') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<h1>Page content</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Lerno workspace navigation', () => {
  it('groups navigation and marks the active route', () => {
    renderShell('/subjects');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    for (const label of ['Study', 'Library', 'You'])
      expect(within(nav).getByText(label)).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'My subjects' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
  });

  it('makes every page reachable from the mobile More dialog and restores focus', async () => {
    const user = userEvent.setup();
    renderShell();
    const more = screen.getByRole('button', { name: 'More' });
    await user.click(more);
    const dialog = screen.getByRole('dialog', { name: 'Your workspace' });
    expect(within(dialog).getByRole('link', { name: 'My subjects' })).toHaveAttribute(
      'href',
      '/subjects',
    );
    expect(within(dialog).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(within(dialog).getByRole('button', { name: 'Log out' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

  it.each(['study', 'practice', 'quiz', 'ai-study'])(
    'keeps %s focused with a route back to the set',
    (mode) => {
      renderShell(`/sets/test-set/${mode}`);
      expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'Mobile navigation' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to set' })).toHaveAttribute(
        'href',
        '/sets/test-set',
      );
    },
  );

  it('submits a library search to the existing Discover route', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.type(
      screen.getByRole('textbox', { name: 'Search the public library' }),
      'cell biology{Enter}',
    );
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Discover' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
