import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readSessionUserFromCookie, clearSessionCookies, type SessionUser } from '@/lib/auth';
import { del } from '@/lib/api-client';

interface AuthContextValue {
  user: SessionUser | null;
  setUser: (u: SessionUser | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    setUser(readSessionUserFromCookie());
  }, []);

  async function logout() {
    try {
      await del('/api/auth/logout');
    } catch {}
    clearSessionCookies();
    setUser(null);
    window.location.href = '/admin/login';
  }

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
