/** Auth provider contract — production uses Supabase Auth; dev uses local JWTs. */

export interface AuthIdentity {
  id: string;
  email: string;
  /** Present on Supabase OAuth-client JWTs, never on normal website sessions. */
  oauthClient?: boolean;
  /** JWT audience, read only after Supabase Auth has validated this very token. */
  audience?: string | string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string | null;
}

export interface SignUpResult {
  identity: AuthIdentity;
  tokens: AuthTokens | null;
  /** True when Supabase requires email confirmation before the first session. */
  needsEmailConfirmation: boolean;
}

export interface SignInResult {
  identity: AuthIdentity;
  tokens: AuthTokens;
}

export interface AuthProvider {
  signUp(email: string, password: string, displayName: string): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<SignInResult>;
  verify(accessToken: string): Promise<AuthIdentity | null>;
  refresh(refreshToken: string): Promise<SignInResult>;
  signOut(accessToken: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
}
