import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

interface AuthState {
  token: string | null;
  isValid: boolean;
  isChecking: boolean;
  isRecovery: boolean;
  label: string | null;
  role: "admin" | "user" | null;
  expiresAt: string | null;
  login: (email: string, password: string) => Promise<string | null>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  logout: () => void;
}

interface SupabaseSessionResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: { email?: string };
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
}

interface AccountResponse {
  email: string;
  role: "admin" | "user";
}

const AuthContext = createContext<AuthState | null>(null);

const ACCESS_TOKEN_KEY = "usst_supabase_access_token";
const REFRESH_TOKEN_KEY = "usst_supabase_refresh_token";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "") as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

function configured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

async function readError(response: Response): Promise<string> {
  const data = await response.json().catch(() => ({})) as SupabaseSessionResponse;
  return data.error_description || data.msg || data.message || data.error || "Request failed";
}

async function authRequest(path: string, body: Record<string, string>): Promise<SupabaseSessionResponse> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase authentication is not configured");
  }

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as SupabaseSessionResponse;
}

async function loadAccount(accessToken: string): Promise<AccountResponse> {
  const response = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || (response.status === 403
      ? "Your account is not authorized for USST"
      : "Unable to verify your USST access"));
  }

  return (await response.json()) as AccountResponse;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [role, setRole] = useState<"admin" | "user" | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setToken(null);
    setAuthTokenGetter(null);
    setIsValid(false);
    setIsRecovery(false);
    setLabel(null);
    setRole(null);
    setExpiresAt(null);
  }, []);

  const acceptSession = useCallback(async (session: SupabaseSessionResponse) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, session.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, session.refresh_token);
    setToken(session.access_token);
    setAuthTokenGetter(() => session.access_token);

    const account = await loadAccount(session.access_token);
    setIsValid(true);
    setIsRecovery(false);
    setLabel(account.email);
    setRole(account.role);
    setExpiresAt(new Date(Date.now() + session.expires_in * 1000).toISOString());
  }, []);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;

    try {
      const session = await authRequest("/auth/v1/token?grant_type=refresh_token", {
        refresh_token: refreshToken,
      });
      await acceptSession(session);
      return true;
    } catch {
      clearSession();
      return false;
    }
  }, [acceptSession, clearSession]);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!configured()) {
        if (!cancelled) setIsChecking(false);
        return;
      }

      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const hashType = hash.get("type");
      const hashAccessToken = hash.get("access_token");
      const hashRefreshToken = hash.get("refresh_token");
      const hashExpiresIn = Number(hash.get("expires_in") || "3600");

      if (hashAccessToken && hashRefreshToken && (hashType === "recovery" || hashType === "invite")) {
        localStorage.setItem(ACCESS_TOKEN_KEY, hashAccessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, hashRefreshToken);
        setToken(hashAccessToken);
        setAuthTokenGetter(() => hashAccessToken);
        setExpiresAt(new Date(Date.now() + hashExpiresIn * 1000).toISOString());
        setIsRecovery(true);
        setIsValid(false);
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        if (!cancelled) setIsChecking(false);
        return;
      }

      const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
      if (!accessToken) {
        if (!cancelled) setIsChecking(false);
        return;
      }

      setToken(accessToken);
      setAuthTokenGetter(() => accessToken);

      try {
        const account = await loadAccount(accessToken);
        if (cancelled) return;
        setIsValid(true);
        setLabel(account.email);
        setRole(account.role);
      } catch {
        if (!cancelled) await refreshSession();
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    }

    void restore();
    return () => { cancelled = true; };
  }, [refreshSession]);

  useEffect(() => {
    if (!isValid || !expiresAt) return;
    const remaining = new Date(expiresAt).getTime() - Date.now();
    const delay = Math.max(30_000, remaining - 5 * 60_000);
    const timer = window.setTimeout(() => { void refreshSession(); }, delay);
    return () => window.clearTimeout(timer);
  }, [expiresAt, isValid, refreshSession]);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    setIsChecking(true);
    try {
      const session = await authRequest("/auth/v1/token?grant_type=password", {
        email: email.trim().toLowerCase(),
        password,
      });
      await acceptSession(session);
      return null;
    } catch (err) {
      clearSession();
      return err instanceof Error ? err.message : "Sign in failed";
    } finally {
      setIsChecking(false);
    }
  }, [acceptSession, clearSession]);

  const requestPasswordReset = useCallback(async (email: string): Promise<string | null> => {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return "Supabase authentication is not configured";

    try {
      const redirectTo = `${window.location.origin}/`;
      const response = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!response.ok) return await readError(response);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Unable to send password reset email";
    }
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<string | null> => {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return "Supabase authentication is not configured";
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!accessToken || !refreshToken) return "Your password reset session has expired. Request a new reset link.";

    setIsChecking(true);
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) return await readError(response);

      const account = await loadAccount(accessToken);
      setIsValid(true);
      setIsRecovery(false);
      setLabel(account.email);
      setRole(account.role);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Unable to update password";
    } finally {
      setIsChecking(false);
    }
  }, []);

  const logout = useCallback(() => {
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    clearSession();

    if (accessToken && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
      void fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
      }).catch(() => undefined);
    }
  }, [clearSession]);

  return (
    <AuthContext.Provider value={{ token, isValid, isChecking, isRecovery, label, role, expiresAt, login, requestPasswordReset, updatePassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
