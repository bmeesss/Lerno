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

const { authState } = vi.hoisted(() => ({ authState: { user: { id: 'user-1' } } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => authState }));

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
const getUserMock = vi.fn();
const fakeClient = { auth: { oauth: oauthMock, getUser: getUserMock } };

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
  authState.user = { id: 'user-1' };
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  oauthMock.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
  oauthMock.approveAuthorization.mockResolvedValue({
    data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz' },
    error: null,
  });
  oauthMock.denyAuthorization.mockResolvedValue({
    data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=xyz' },
    error: null,
  });
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
    expect(oauthMock.approveAuthorization).toHaveBeenCalledWith('auth-1', {
      skipBrowserRedirect: true,
    });
  });

  it('denies through Supabase', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^deny$/i }));
    expect(oauthMock.denyAuthorization).toHaveBeenCalledWith('auth-1', {
      skipBrowserRedirect: true,
    });
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
    oauthMock.getAuthorizationDetails.mockResolvedValue({
      data: null,
      error: { message: 'Expired request' },
    });
    renderPage();
    expect(
      await screen.findByText('This authorization request is invalid or expired.'),
    ).toBeInTheDocument();
  });

  it('shows decision errors and stays on the page', async () => {
    oauthMock.approveAuthorization.mockResolvedValue({
      data: null,
      error: { message: 'Denied upstream' },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /allow access/i }));
    expect(
      await screen.findByText('Authorization could not be completed. Please try again.'),
    ).toBeInTheDocument();
  });
});

describe('OAuth redirect safety', () => {
  it('rejects a provider response that does not match the registered callback', async () => {
    oauthMock.approveAuthorization.mockResolvedValue({
      data: { redirect_url: 'https://attacker.example/collect?code=abc' },
      error: null,
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /allow access/i }));
    expect(await screen.findByText('Invalid client redirect.')).toBeInTheDocument();
  });

  it('rejects authorization ids that could be used as a URL or control sequence', async () => {
    renderPage('/oauth/consent?authorization_id=https%3A%2F%2Fevil.example');
    expect(await screen.findByText(/missing authorization_id/i)).toBeInTheDocument();
    expect(oauthMock.getAuthorizationDetails).not.toHaveBeenCalled();
  });
});

describe('OAuth consent account binding', () => {
  it('refuses a consent request for a different user even with a valid app session', async () => {
    oauthMock.getAuthorizationDetails.mockResolvedValue({
      data: { ...DETAILS, user: { id: 'other-user', email: 'other@example.test' } },
      error: null,
    });
    renderPage();
    expect(await screen.findByText('Account changed. Please log in again.')).toBeInTheDocument();
    expect(oauthMock.approveAuthorization).not.toHaveBeenCalled();
  });

  it('refuses a stale Supabase session before revealing a previously approved redirect', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'other-user' } }, error: null });
    oauthMock.getAuthorizationDetails.mockResolvedValue({
      data: { redirect_url: 'https://example.test/callback?code=sensitive' },
      error: null,
    });
    renderPage();
    expect(await screen.findByText('Account changed. Please log in again.')).toBeInTheDocument();
    expect(oauthMock.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it('rechecks identity before approving if the session changes mid-consent', async () => {
    const actor = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: /allow access/i });
    getUserMock.mockResolvedValue({ data: { user: { id: 'other-user' } }, error: null });
    await actor.click(screen.getByRole('button', { name: /allow access/i }));
    expect(await screen.findByText('Account changed. Please log in again.')).toBeInTheDocument();
    expect(oauthMock.approveAuthorization).not.toHaveBeenCalled();
  });
});
