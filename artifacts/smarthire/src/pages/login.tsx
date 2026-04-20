import React, { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { Logo } from "../components/Logo";

interface LoginResponse {
  token: string;
  user: { id: number; email: string; name: string; role: string };
}


export default function LoginPage() {
  const [, navigate] = useLocation();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Login failed");
      }

      const data = (await res.json()) as LoginResponse;
      login(data.token, data.user);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  const features = [
    "AI-powered L1 screening interviews",
    "Dynamic conversational questions",
    "Automatic candidate evaluation",
    "Detailed scorecards & recordings",
    "Recruiter & admin dashboards",
  ];

  return (
    <div className="min-h-screen flex">
      {/* ── Left column (hidden on mobile) ── */}
      <div
        className="hidden lg:flex flex-col justify-between w-1/2 p-12 text-white"
        style={{ background: "#0F172A" }}
      >
        <div>
          <div className="mb-8"><Logo variant="light" size={40} /></div>
        </div>

        <div className="space-y-6">
          <p className="text-3xl font-bold leading-snug">
            AI-powered interviews,<br />human insights
          </p>
          <ul className="space-y-3">
            {features.map((f) => (
              <li key={f} className="flex items-center gap-3 text-white/90">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0" style={{ color: '#6366F1' }} />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-white/60 text-sm">
          &copy; {new Date().getFullYear()} AccionHire — Powered by Accionlabs
        </p>
      </div>

      {/* ── Right column ── */}
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md space-y-8">
          {/* Logo (mobile only) */}
          <div className="lg:hidden mb-6">
            <Logo variant="dark" size={32} />
          </div>

          <div>
            <h1 className="text-3xl font-bold tracking-tight">Welcome Back</h1>
            <p className="text-muted-foreground mt-1">Sign in to your AccionHire account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email address
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full text-white font-semibold py-5"
              style={{ backgroundColor: "#6366F1" }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          <div className="rounded-lg bg-muted/50 border px-4 py-3 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Demo credentials</p>
            <p className="text-xs text-muted-foreground">
              Admin: <span className="font-mono text-foreground">admin@accionhire.com</span> /{" "}
              <span className="font-mono text-foreground">Admin@123</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Recruiter: <span className="font-mono text-foreground">recruiter@accionhire.com</span> /{" "}
              <span className="font-mono text-foreground">Recruiter@123</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
