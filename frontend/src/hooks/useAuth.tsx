/**
 * Auth context — session state for the whole app.
 *
 * Persistence is real (backend → Supabase Auth in production); tokens live in
 * localStorage and are attached to every API call by lib/api.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, clearTokens, getAccessToken, setTokens } from '../lib/api';
import type { AuthResult, AuthUser, Profile, SignupResult } from '../types';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<SignupResult>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updateProfile: (updates: {
    displayName?: string;
    avatarUrl?: string | null;
    timezone?: string;
  }) => Promise<Profile>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null);
      return;
    }
    const me = await api.get<AuthUser>('/auth/me');
    setUser(me);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshUser();
      } catch {
        clearTokens();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<AuthResult>('/auth/login', { email, password });
    setTokens(result.accessToken, result.refreshToken);
    setUser(result.user);
  }, []);

  const signup = useCallback(async (email: string, password: string, displayName: string) => {
    const result = await api.post<SignupResult>('/auth/signup', { email, password, displayName });
    if (result.accessToken) {
      setTokens(result.accessToken, result.refreshToken);
      setUser(result.user);
    }
    return result;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearTokens();
      setUser(null);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    await api.post('/auth/reset-password', { email });
  }, []);

  const updateProfile = useCallback(
    async (updates: { displayName?: string; avatarUrl?: string | null; timezone?: string }) => {
      const profile = await api.patch<Profile>('/profile', updates);
      setUser((current) => (current ? { ...current, profile } : current));
      return profile;
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      signup,
      logout,
      requestPasswordReset,
      updateProfile,
      refreshUser,
    }),
    [user, loading, login, signup, logout, requestPasswordReset, updateProfile, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
