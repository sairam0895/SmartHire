import React from "react";
import { Link, useLocation } from "wouter";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Logo } from "./Logo";

function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
      {initials}
    </div>
  );
}

export function Navbar() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center px-4">
        <Logo variant="dark" size={32} />

        <div className="flex flex-1 items-center justify-end space-x-4">
          {user ? (
            <>
              <Link
                href="/create"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
              >
                New Interview
              </Link>

              {/* User info */}
              <div className="flex items-center gap-2">
                <UserAvatar name={user.name} />
                <div className="hidden sm:block leading-tight">
                  <p className="text-sm font-medium leading-none">{user.name}</p>
                  <Badge
                    variant="secondary"
                    className={`text-xs mt-0.5 ${
                      user.role === "admin"
                        ? "bg-[#EEF2FF] text-[#6366F1] hover:bg-[#EEF2FF]"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {user.role === "admin" ? "Admin" : "Recruiter"}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={logout}
                  title="Sign out"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <nav className="flex items-center space-x-2">
              <Link
                href="/create"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
              >
                New Interview
              </Link>
            </nav>
          )}
        </div>
      </div>
    </nav>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">{children}</main>
    </div>
  );
}
