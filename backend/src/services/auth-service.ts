/**
 * Auth service — signup/login/session flows on top of the auth provider
 * (Supabase Auth in production) and profile persistence.
 */
import type { AuthIdentity, AuthTokens } from '../lib/auth/index.js';
import { getAuthProvider } from '../lib/auth/index.js';
import type { Database } from '../lib/db/repository.js';
import { dto } from '../lib/dto.js';
import { errors } from '../lib/errors.js';

export interface AuthResultDto {
  accessToken: string | null;
  refreshToken: string | null;
  user: { id: string; email: string; profile: ReturnType<typeof dto.profile> };
  needsEmailConfirmation: boolean;
}

async function userPayload(
  db: Database,
  identity: AuthIdentity,
  displayName?: string,
): Promise<AuthResultDto['user']> {
  let profile = await db.profiles.get(identity.id);
  if (!profile && displayName !== undefined) {
    profile = await db.profiles.upsert({ id: identity.id, displayName });
  }
  if (!profile) {
    // First login raced profile creation (e.g. Supabase trigger) — create it.
    profile = await db.profiles.upsert({
      id: identity.id,
      displayName: identity.email.split('@')[0] ?? 'Student',
    });
  }
  return { id: identity.id, email: identity.email, profile: dto.profile(profile) };
}

function authResult(
  user: AuthResultDto['user'],
  tokens: AuthTokens | null,
  needsEmailConfirmation: boolean,
): AuthResultDto {
  return {
    accessToken: tokens?.accessToken ?? null,
    refreshToken: tokens?.refreshToken ?? null,
    user,
    needsEmailConfirmation,
  };
}

export const authService = {
  async signup(
    db: Database,
    input: { email: string; password: string; displayName: string },
  ): Promise<AuthResultDto> {
    const provider = getAuthProvider();
    const result = await provider.signUp(input.email, input.password, input.displayName);

    if (!result.tokens) {
      // Email confirmation required: profile is created by the auth flow/trigger.
      const profileDb = db;
      const profile = await profileDb.profiles
        .upsert({ id: result.identity.id, displayName: input.displayName })
        .catch(() => null);
      const user = profile
        ? { id: result.identity.id, email: result.identity.email, profile: dto.profile(profile) }
        : {
            id: result.identity.id,
            email: result.identity.email,
            profile: dto.profile({
              id: result.identity.id,
              displayName: input.displayName,
              avatarUrl: null,
              role: 'user' as const,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
          };
      return authResult(user, null, true);
    }

    // Ensure the profile exists with the chosen display name.
    const user = await userPayload(db, result.identity, input.displayName);
    return authResult(user, result.tokens, false);
  },

  async login(db: Database, input: { email: string; password: string }): Promise<AuthResultDto> {
    const provider = getAuthProvider();
    const result = await provider.signIn(input.email, input.password);
    const user = await userPayload(db, result.identity);
    return authResult(user, result.tokens, false);
  },

  async refresh(db: Database, refreshToken: string): Promise<AuthResultDto> {
    const provider = getAuthProvider();
    const result = await provider.refresh(refreshToken);
    const user = await userPayload(db, result.identity);
    return authResult(user, result.tokens, false);
  },

  async me(db: Database, identity: AuthIdentity): Promise<AuthResultDto['user']> {
    return userPayload(db, identity);
  },

  async logout(accessToken: string | null): Promise<void> {
    if (accessToken) await getAuthProvider().signOut(accessToken);
  },

  async requestPasswordReset(email: string): Promise<void> {
    await getAuthProvider().requestPasswordReset(email);
  },

  async requireIdentity(reqAuth: AuthIdentity | undefined): Promise<AuthIdentity> {
    if (!reqAuth) throw errors.unauthorized('You must be logged in to do this');
    return reqAuth;
  },
};
