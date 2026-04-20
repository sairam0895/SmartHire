import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Configure api-client-react to use our base URL and token
  useEffect(() => {
    setBaseUrl(apiUrl);
    setAuthTokenGetter(() => localStorage.getItem("accionhire_token"));
  }, []);

  // Verify token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem("accionhire_token");
    const storedUser = localStorage.getItem("accionhire_user");

    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    // Verify with the server
    fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { user: AuthUser }) => {
        setToken(storedToken);
        setUser(data.user);
        localStorage.setItem("accionhire_user", JSON.stringify(data.user));
      })
      .catch(() => {
        // Token invalid — try stored user as fallback, then clear
        if (storedUser) {
          try {
            setToken(storedToken);
            setUser(JSON.parse(storedUser) as AuthUser);
          } catch {
            localStorage.removeItem("accionhire_token");
            localStorage.removeItem("accionhire_user");
          }
        } else {
          localStorage.removeItem("accionhire_token");
          localStorage.removeItem("accionhire_user");
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    localStorage.setItem("accionhire_token", newToken);
    localStorage.setItem("accionhire_user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("accionhire_token");
    localStorage.removeItem("accionhire_user");
    setToken(null);
    setUser(null);
    window.location.href = "/login";
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAdmin: user?.role === "admin",
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
