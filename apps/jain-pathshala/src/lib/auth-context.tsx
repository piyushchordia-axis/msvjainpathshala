import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readSessionUserFromCookie, clearSessionCookies, type SessionUser } from '@/lib/auth';
import { post } from '@/lib/api-client';

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  setUser: (u: SessionUser | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  setUser: () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(readSessionUserFromCookie());
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/api/auth/logout', {});
    } catch {}
    clearSessionCookies();
    setUser(null);
    window.location.href = '/admin/login';
  }, []);

  const value = useMemo(
    () => ({ user, loading, setUser, logout }),
    [user, loading, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
