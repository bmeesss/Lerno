/**
 * Development auth provider: local email/password with scrypt hashing and
 * signed JWTs. Used only when Supabase is not configured (development data
 * mode / tests). Production always uses Supabase Auth (supabase-auth.ts).
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { devJwtSecret } from '../../config.js';
import { errors } from '../errors.js';
import { memoryAddUser, type MemoryState } from '../db/memory.js';
import type { AuthProvider, AuthIdentity, SignInResult, SignUpResult } from './types.js';

interface Credential {
  userId: string;
  passwordHash: string;
  salt: string;
}

const ACCESS_TTL = '7d';
const REFRESH_TTL = '30d';

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex');
}

interface TokenPayload {
  sub: string;
  email: string;
  typ: 'access' | 'refresh';
}

export function createDevAuthProvider(state: MemoryState): AuthProvider {
  const credentials = new Map<string, Credential>();

  function signToken(identity: AuthIdentity, typ: 'access' | 'refresh'): string {
    const payload: TokenPayload = { sub: identity.id, email: identity.email, typ };
    return jwt.sign(payload, devJwtSecret(), {
      expiresIn: typ === 'access' ? ACCESS_TTL : REFRESH_TTL,
    });
  }

  function issueTokens(identity: AuthIdentity): { accessToken: string; refreshToken: string } {
    return {
      accessToken: signToken(identity, 'access'),
      refreshToken: signToken(identity, 'refresh'),
    };
  }

  function readToken(token: string): TokenPayload | null {
    try {
      return jwt.verify(token, devJwtSecret()) as TokenPayload;
    } catch {
      return null;
    }
  }

  return {
    async signUp(email, password, displayName): Promise<SignUpResult> {
      const normalized = email.trim().toLowerCase();
      if (credentials.has(normalized)) {
        throw errors.conflict('An account with this email already exists');
      }
      const userId = randomUUID();
      const salt = randomBytes(16).toString('hex');
      credentials.set(normalized, { userId, passwordHash: hashPassword(password, salt), salt });

      const createdAt = new Date().toISOString();
      memoryAddUser(
        state,
        { id: userId, email: normalized, createdAt },
        {
          id: userId,
          displayName,
          avatarUrl: null,
          role: 'user',
          createdAt,
          updatedAt: createdAt,
        },
      );

      const identity: AuthIdentity = { id: userId, email: normalized };
      return { identity, tokens: issueTokens(identity), needsEmailConfirmation: false };
    },

    async signIn(email, password): Promise<SignInResult> {
      const normalized = email.trim().toLowerCase();
      const credential = credentials.get(normalized);
      if (!credential) {
        throw errors.unauthorized('Invalid email or password');
      }
      const hash = hashPassword(password, credential.salt);
      const expected = Buffer.from(credential.passwordHash, 'hex');
      const actual = Buffer.from(hash, 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        throw errors.unauthorized('Invalid email or password');
      }
      const identity: AuthIdentity = { id: credential.userId, email: normalized };
      return { identity, tokens: issueTokens(identity) };
    },

    async verify(accessToken): Promise<AuthIdentity | null> {
      const payload = readToken(accessToken);
      if (!payload || payload.typ !== 'access') return null;
      return { id: payload.sub, email: payload.email };
    },

    async refresh(refreshToken): Promise<SignInResult> {
      const payload = readToken(refreshToken);
      if (!payload || payload.typ !== 'refresh') {
        throw errors.unauthorized('Invalid refresh token');
      }
      const identity: AuthIdentity = { id: payload.sub, email: payload.email };
      return { identity, tokens: issueTokens(identity) };
    },

    async signOut(): Promise<void> {
      // Stateless dev tokens: nothing to revoke.
    },

    async requestPasswordReset(email): Promise<void> {
      // Dev mode: always succeed silently (no mail infrastructure).
      void email;
    },
  };
}
