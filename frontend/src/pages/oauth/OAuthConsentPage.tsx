/**
 * OAuth consent screen (Phase 7.5).
 *
 * Supabase Auth redirects here (Site URL + Authorization Path) when an MCP
 * client starts the OAuth 2.1 flow: /oauth/consent?authorization_id=…
 * The page shows which client asks for what, then approves/denies via
 * Supabase and redirects back to the returned redirect_url.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState, LoadingRow } from '../../components/ui/Primitives';
import {
  attachLernoSession,
  getSupabaseClient,
  isSupabaseOAuthConfigured,
} from '../../lib/supabase';
import { AuthLayout } from '../auth/AuthLayout';

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: 'Verify your identity',
  profile: 'See your basic Lerno profile',
  email: 'See your email address',
  phone: 'See your phone number',
};

type Status =
  | { kind: 'loading' }
  | { kind: 'not-configured' }
  | { kind: 'session-expired' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; details: OAuthAuthorizationDetails; busy: boolean };

export function OAuthConsentPage() {
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id');
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    if (!authorizationId) {
      setStatus({ kind: 'error', message: 'Missing authorization_id. Start again from your AI app.' });
      return;
    }
    if (!isSupabaseOAuthConfigured()) {
      setStatus({ kind: 'not-configured' });
      return;
    }
    let cancelled = false;
    void (async () => {
      const client = getSupabaseClient();
      if (!client) {
        if (!cancelled) setStatus({ kind: 'not-configured' });
        return;
      }
      if (!(await attachLernoSession(client))) {
        if (!cancelled) setStatus({ kind: 'session-expired' });
        return;
      }
      const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
      if (cancelled) return;
      if (error || !data) {
        setStatus({
          kind: 'error',
          message: error?.message ?? 'This authorization request is invalid or expired.',
        });
        return;
      }
      if (!('authorization_id' in data)) {
        // Already consented: Supabase returned the client redirect directly.
        window.location.assign(data.redirect_url);
        return;
      }
      setStatus({ kind: 'ready', details: data, busy: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [authorizationId]);

  async function decide(approve: boolean): Promise<void> {
    if (status.kind !== 'ready' || !authorizationId) return;
    setStatus({ ...status, busy: true });
    const client = getSupabaseClient();
    if (!client) {
      setStatus({ kind: 'not-configured' });
      return;
    }
    const { error } = approve
      ? await client.auth.oauth.approveAuthorization(authorizationId)
      : await client.auth.oauth.denyAuthorization(authorizationId);
    if (error) {
      setStatus({ kind: 'error', message: error.message });
      return;
    }
    // Success auto-redirects to the AI app (Supabase handles the redirect).
  }

  if (status.kind === 'loading') {
    return (
      <AuthLayout title="Connecting your AI app" subtitle="Loading the authorization request…">
        <LoadingRow large />
      </AuthLayout>
    );
  }

  if (status.kind === 'not-configured') {
    return (
      <AuthLayout title="OAuth not available" subtitle="This Lerno environment has no OAuth server configured.">
        <EmptyState
          title="Not configured"
          description="AI-app connections need a Lerno environment with Supabase OAuth enabled."
          action={<ButtonLink to="/dashboard">Back to dashboard</ButtonLink>}
        />
      </AuthLayout>
    );
  }

  if (status.kind === 'session-expired') {
    const next = encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`);
    return (
      <AuthLayout title="Session expired" subtitle="Log in again to continue connecting your AI app.">
        <EmptyState
          title="Log in again"
          description="Your Lerno session expired before the connection finished."
          action={<ButtonLink to={`/login?next=${next}`}>Log in</ButtonLink>}
        />
      </AuthLayout>
    );
  }

  if (status.kind === 'error') {
    return (
      <AuthLayout title="Connection failed" subtitle="This authorization request could not be completed.">
        <EmptyState
          title="Something went wrong"
          description={status.message}
          action={<ButtonLink to="/dashboard">Back to dashboard</ButtonLink>}
        />
      </AuthLayout>
    );
  }

  const scopes = status.details.scope.split(' ').filter(Boolean);
  return (
    <AuthLayout
      title={`Authorize ${status.details.client.name}`}
      subtitle="An AI app wants to access your Lerno account."
    >
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="stat-label">Application</div>
        <div style={{ fontWeight: 600 }}>{status.details.client.name}</div>
        <div className="muted" style={{ fontSize: '0.875rem', marginTop: 4 }}>
          Returns to: {status.details.redirect_uri}
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="stat-label">Requested access</div>
        {scopes.length > 0 ? (
          <ul className="stack" style={{ gap: 6, marginTop: 8 }}>
            {scopes.map((scope) => (
              <li key={scope} style={{ fontSize: '0.925rem' }}>
                • {SCOPE_DESCRIPTIONS[scope] ?? scope}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No special permissions requested.</p>
        )}
        <p className="muted" style={{ fontSize: '0.875rem', marginTop: 10 }}>
          Lerno shares only your learning data with this app — never your password. You can revoke
          access at any time.
        </p>
      </div>
      <div className="study-controls">
        <Button
          variant="secondary"
          disabled={status.busy}
          onClick={() => void decide(false)}
        >
          Deny
        </Button>
        <Button disabled={status.busy} onClick={() => void decide(true)}>
          {status.busy ? 'Connecting…' : 'Allow access'}
        </Button>
      </div>
    </AuthLayout>
  );
}
