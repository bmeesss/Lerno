/**
 * Production auth provider — Supabase Auth (GoTrue) via @supabase/supabase-js.
 * Passwords are handled by Supabase Auth (spec §9); this module never sees or
 * stores passwords itself.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import { errors } from '../errors.js';
import type { AuthProvider, AuthIdentity, SignInResult, SignUpResult } from './types.js';

function anonClient(): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function mapAuthError(
  error: { message: string; status?: number },
  context: 'signup' | 'signin',
): never {
  const message = error.message.toLowerCase();
  if (message.includes('already registered') || message.includes('already been registered')) {
    throw errors.conflict('An account with this email already exists');
  }
  if (context === 'signin') {
    // Never reveal whether the account exists (spec §15).
    throw errors.unauthorized('Invalid email or password');
  }
  if (message.includes('password') && message.includes('least')) {
    throw errors.validation('Password does not meet the minimum requirements');
  }
  if (error.status === 429) {
    throw errors.rateLimited();
  }
  throw errors.validation('Could not create account with these details');
}

function identityFromUser(user: { id: string; email?: string }): AuthIdentity {
  return { id: user.id, email: user.email ?? '' };
}

export function createSupabaseAuthProvider(): AuthProvider {
  return {
    async signUp(email, password, displayName): Promise<SignUpResult> {
      const client = anonClient();
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });
      if (error) mapAuthError(error, 'signup');
      if (!data.user) throw errors.internal('Signup failed');

      const identity = identityFromUser(data.user);
      if (!data.session) {
        return { identity, tokens: null, needsEmailConfirmation: true };
      }
      return {
        identity,
        tokens: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        },
        needsEmailConfirmation: false,
      };
    },

    async signIn(email, password): Promise<SignInResult> {
      const client = anonClient();
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) mapAuthError(error, 'signin');
      if (!data.session || !data.user) throw errors.unauthorized('Invalid email or password');
      return {
        identity: identityFromUser(data.user),
        tokens: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        },
      };
    },

    async verify(accessToken): Promise<AuthIdentity | null> {
      const client = anonClient();
      const { data, error } = await client.auth.getUser(accessToken);
      if (error || !data.user) return null;
      return identityFromUser(data.user);
    },

    async refresh(refreshToken): Promise<SignInResult> {
      const client = anonClient();
      const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session || !data.user) {
        throw errors.unauthorized('Invalid refresh token');
      }
      return {
        identity: identityFromUser(data.user),
        tokens: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        },
      };
    },

    async signOut(accessToken): Promise<void> {
      const client = anonClient();
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
      void accessToken;
    },

    async requestPasswordReset(email): Promise<void> {
      const client = anonClient();
      const redirectTo = `${config.frontendUrls[0] ?? 'http://localhost:5173'}/reset-password`;
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error && error.status === 429) throw errors.rateLimited();
      // Always succeed otherwise: do not reveal whether the account exists.
    },
  };
}
