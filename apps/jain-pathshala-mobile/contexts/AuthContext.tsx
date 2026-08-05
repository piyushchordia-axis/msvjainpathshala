import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiPost, setAuthToken, setRefreshToken, setTokenPersistor } from "@/lib/api";
import { registerPushTokenWithApi } from "@/lib/push";
import { secureStorage } from "@/lib/secure-storage";
import type { AuthTokens, SessionUser } from "@/lib/auth";

const TOKEN_KEY = "jp_access_token";
const REFRESH_KEY = "jp_refresh_token";
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

  // Persist the rotated pair whenever the api layer does a silent refresh.
  useEffect(() => {
    setTokenPersistor((access, refresh) => {
      void secureStorage.setItem(TOKEN_KEY, access);
      void secureStorage.setItem(REFRESH_KEY, refresh);
    });
    return () => setTokenPersistor(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [token, refresh, rawUser] = await Promise.all([
          secureStorage.getItem(TOKEN_KEY),
          secureStorage.getItem(REFRESH_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        if (token) setAuthToken(token);
        if (refresh) setRefreshToken(refresh);
        if (rawUser) setUser(JSON.parse(rawUser) as SessionUser);
        // Cold-start of an already-signed-in session: (re)register this device
        // for push, best-effort. Covers reinstall/restore/permission changes
        // where sign-in never runs again. No-ops in Expo Go / placeholder EAS
        // project (guarded in lib/push.ts) and never blocks hydration.
        if (token && rawUser) void registerPushTokenWithApi();
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(
    async (nextUser: SessionUser, tokens: AuthTokens) => {
      // Drop any cached data belonging to a previously signed-in account on this
      // device before the new user's queries run.
      queryClient.clear();
      setAuthToken(tokens.access_token);
      setRefreshToken(tokens.refresh_token);
      setUser(nextUser);
      await Promise.all([
        secureStorage.setItem(TOKEN_KEY, tokens.access_token),
        secureStorage.setItem(REFRESH_KEY, tokens.refresh_token),
        AsyncStorage.setItem(USER_KEY, JSON.stringify(nextUser)),
      ]);
      // Register this device for push, best-effort — must never block sign-in.
      void registerPushTokenWithApi();
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    // Send the refresh token so the server revokes the session (mobile has no
    // cookie); short access TTL means the access token also lapses quickly.
    const refresh = await secureStorage.getItem(REFRESH_KEY).catch(() => null);
    try {
      await apiPost("/api/auth/logout", refresh ? { refresh_token: refresh } : {});
    } catch {}
    setAuthToken(null);
    setRefreshToken(null);
    setUser(null);
    queryClient.clear();
    await Promise.all([
      secureStorage.removeItem(TOKEN_KEY),
      secureStorage.removeItem(REFRESH_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
  }, [queryClient]);

  const value = useMemo(
    () => ({ user, loading, signIn, logout }),
    [user, loading, signIn, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
