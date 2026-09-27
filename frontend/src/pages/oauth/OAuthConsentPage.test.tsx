import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachLernoSession,
  getSupabaseClient,
  isSupabaseOAuthConfigured,
} from '../../lib/supabase';
import { OAuthConsentPage } from './OAuthConsentPage';

vi.mock('../../lib/supabase', () => ({
  isSupabaseOAuthConfigured: vi.fn(),
  getSupabaseClient: vi.fn(),
  attachLernoSession: vi.fn(),
}));

const configuredMock = vi.mocked(isSupabaseOAuthConfigured);
const clientMock = vi.mocked(getSupabaseClient);
const attachMock = vi.mocked(attachLernoSession);

const oauthMock = {
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
};
const fakeClient = { auth: { oauth: oauthMock } };

function renderPage(entry = '/oauth/consent?authorization_id=auth-1') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/oauth/consent" element={<OAuthConsentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const DETAILS = {
  authorization_id: 'auth-1',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client: { id: 'client-1', name: 'Claude', uri: 'https://claude.ai', logo_uri: '' },
  user: { id: 'user-1', email: 'student@example.com' },
  scope: 'openid profile email',
};

beforeEach(() => {
  vi.clearAllMocks();
  configuredMock.mockReturnValue(true);
  clientMock.mockReturnValue(fakeClient as never);
  attachMock.mockResolvedValue(true);
  oauthMock.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
  oauthMock.approveAuthorization.mockResolvedValue({ data: { redirect_url: 'https://cb/ok' }, error: null });
  oauthMock.denyAuthorization.mockResolvedValue({ data: { redirect_url: 'https://cb/denied' }, error: null });
});

describe('OAuthConsentPage', () => {
  it('shows the requesting client with friendly scope descriptions', async () => {
    renderPage();
    expect(await screen.findByText('Authorize Claude')).toBeInTheDocument();
    expect(screen.getByText(/claude.ai\/api\/mcp\/auth_callback/)).toBeInTheDocument();
    expect(screen.getByText(/Verify your identity/)).toBeInTheDocument();
    expect(screen.getByText(/basic Lerno profile/)).toBeInTheDocument();
    expect(screen.getByText(/your email address/)).toBeInTheDocument();
    expect(oauthMock.getAuthorizationDetails).toHaveBeenCalledWith('auth-1');
  });

  it('approves and denies through Supabase', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /allow access/i }));
    expect(oauthMock.approveAuthorization).toHaveBeenCalledWith('auth-1');
  });

  it('denies through Supabase', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^deny$/i }));
    expect(oauthMock.denyAuthorization).toHaveBeenCalledWith('auth-1');
  });

  it('redirects immediately when consent was already given', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    try {
      oauthMock.getAuthorizationDetails.mockResolvedValue({
        data: { redirect_url: 'https://cb/auto' },
        error: null,
      });
      renderPage();
      await screen.findByText(/loading the authorization request/i);
      expect(assign).toHaveBeenCalledWith('https://cb/auto');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows a clear error without authorization_id', async () => {
    renderPage('/oauth/consent');
    expect(await screen.findByText(/missing authorization_id/i)).toBeInTheDocument();
    expect(oauthMock.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('shows a not-configured state without Supabase env', async () => {
    configuredMock.mockReturnValue(false);
    renderPage();
    expect(await screen.findByText('Not configured')).toBeInTheDocument();
  });

  it('asks for a fresh login when the session cannot attach', async () => {
    attachMock.mockResolvedValue(false);
    renderPage();
    expect(await screen.findByText('Log in again')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute(
      'href',
      '/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dauth-1',
    );
  });

  it('shows Supabase errors without internals', async () => {
    oauthMock.getAuthorizationDetails.mockResolvedValue({ data: null, error: { message: 'Expired request' } });
    renderPage();
    expect(await screen.findByText('Expired request')).toBeInTheDocument();
  });

  it('shows decision errors and stays on the page', async () => {
    oauthMock.approveAuthorization.mockResolvedValue({ data: null, error: { message: 'Denied upstream' } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /allow access/i }));
    expect(await screen.findByText('Denied upstream')).toBeInTheDocument();
  });
});
