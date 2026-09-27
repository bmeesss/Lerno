import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../hooks/useAuth';
import { LandingPage } from './LandingPage';

function renderLanding() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LandingPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LandingPage', () => {
  it('shows the hero and core calls to action', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/study smarter/i);
    expect(screen.getByRole('link', { name: /start learning free/i })).toHaveAttribute(
      'href',
      '/signup',
    );
    expect(screen.getByRole('link', { name: /explore study sets/i })).toHaveAttribute(
      'href',
      '/discover',
    );
  });

  it('states the free-first promise', () => {
    renderLanding();
    expect(screen.getAllByText(/no daily study limits/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no premium paywall/i).length).toBeGreaterThan(0);
  });

  it('renders the main sections', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: /everything you need/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /how it works/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /free-first, for real/i })).toBeInTheDocument();
  });
});
