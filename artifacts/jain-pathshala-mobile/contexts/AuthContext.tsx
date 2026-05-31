import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiPost, setAuthToken } from "@/lib/api";
import type { AuthTokens, SessionUser } from "@/lib/auth";

const TOKEN_KEY = "jp_access_token";
const USER_KEY = "jp_user";

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  signIn: (user: SessionUser, tokens: AuthTokens) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signIn: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [token, rawUser] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        if (token) setAuthToken(token);
        if (rawUser) setUser(JSON.parse(rawUser) as SessionUser);
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function signIn(nextUser: SessionUser, tokens: AuthTokens) {
    // Drop any cached data belonging to a previously signed-in account on this
    // device before the new user's queries run.
    queryClient.clear();
    setAuthToken(tokens.access_token);
    setUser(nextUser);
    await Promise.all([
      AsyncStorage.setItem(TOKEN_KEY, tokens.access_token),
      AsyncStorage.setItem(USER_KEY, JSON.stringify(nextUser)),
    ]);
  }

  async function logout() {
    try {
      await apiPost("/api/auth/logout", {});
    } catch {}
    setAuthToken(null);
    setUser(null);
    queryClient.clear();
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
