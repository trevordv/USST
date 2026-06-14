import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";

interface AuthState {
  token: string | null;
  isValid: boolean;
  isChecking: boolean;
  label: string | null;
  expiresAt: string | null;
  setToken: (token: string | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = "solar_access_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const checkInProgress = useRef(false);

  // Load token from localStorage on mount, and also check URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      setTokenState(urlToken);
      localStorage.setItem(STORAGE_KEY, urlToken);
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.toString());
      return;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setTokenState(stored);
    }
  }, []);

  // Validate token whenever it changes
  const checkToken = useCallback(async (tok: string) => {
    if (checkInProgress.current) return;
    checkInProgress.current = true;
    setIsChecking(true);
    try {
      const res = await fetch("/api/auth/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tok }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsValid(data.valid);
        setLabel(data.label ?? null);
        setExpiresAt(data.expiresAt ?? null);
      } else {
        setIsValid(false);
      }
    } catch {
      setIsValid(false);
    } finally {
      setIsChecking(false);
      checkInProgress.current = false;
    }
  }, []);

  useEffect(() => {
    if (token) {
      checkToken(token);
    } else {
      setIsValid(false);
      setIsChecking(false);
      setLabel(null);
      setExpiresAt(null);
    }
  }, [token, checkToken]);

  const setToken = useCallback((newToken: string | null) => {
    if (newToken) {
      localStorage.setItem(STORAGE_KEY, newToken);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    setTokenState(newToken);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setTokenState(null);
    setIsValid(false);
    setLabel(null);
    setExpiresAt(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ token, isValid, isChecking, label, expiresAt, setToken, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
