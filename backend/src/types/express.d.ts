import type { Database } from '../lib/db/repository.js';
import type { Role } from '../lib/db/types.js';

export interface AuthContext {
  id: string;
  email: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      /** Verified caller identity (set by requireAuth / optionalAuth). */
      auth?: AuthContext;
      /** Database bound to the caller's access token (RLS in production). */
      db: Database;
    }
  }
}
