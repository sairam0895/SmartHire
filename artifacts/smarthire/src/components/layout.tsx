import React from "react";
import { Link } from "wouter";
import { Briefcase } from "lucide-react";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Briefcase className="h-5 w-5 text-accent" />
          <span><span className="text-accent">Accion</span><span className="text-primary">Hire</span></span>
        </Link>
        <div className="flex flex-1 items-center justify-end space-x-4">
          <nav className="flex items-center space-x-2">
            <Link 
              href="/create" 
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              New Interview
            </Link>
          </nav>
        </div>
      </div>
    </nav>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">
        {children}
      </main>
    </div>
  );
}
