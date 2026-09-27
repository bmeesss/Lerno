import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api';
import { AuthLayout } from './AuthLayout';

export function SignupPage() {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await signup(email.trim(), password, displayName.trim());
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Signup failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Free forever for core learning features. No credit card, no limits."
    >
      <form className="auth-form" onSubmit={onSubmit}>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="field">
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            className="input"
            type="text"
            autoComplete="nickname"
            required
            maxLength={60}
            placeholder="e.g. Sam de Vries"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            At least 8 characters.
          </span>
        </div>
        <Button type="submit" block disabled={busy}>
          {busy ? 'Creating account…' : 'Create free account'}
        </Button>
      </form>
      <div className="auth-alt">
        Already have an account? <Link to="/login">Log in</Link>
      </div>
    </AuthLayout>
  );
}
