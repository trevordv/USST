import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard,
  Database,
  Activity,
  KeyRound,
  LogOut,
  FileSearch,
} from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { logout } = useAuth();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/projects", label: "Projects", icon: Database },
    { href: "/scans", label: "Scan History", icon: Activity },
    { href: "/epbc", label: "EPBC Projects", icon: FileSearch },
    { href: "/invite", label: "Invites", icon: KeyRound },
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="h-20 flex items-center px-4 border-b border-sidebar-border">
          <Link href="/" className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="USST Logo"
              className="h-12 w-12 object-contain flex-shrink-0"
            />
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-sm tracking-tight text-sidebar-foreground">Utility Scale</span>
              <span className="font-bold text-sm tracking-tight text-sidebar-foreground">Solar Tracker</span>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border space-y-2">
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
          <div className="text-xs text-sidebar-foreground/50 text-center font-mono">
            SYS_STATUS: ONLINE
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
