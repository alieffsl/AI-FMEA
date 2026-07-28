import { useState, useEffect, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  LayoutDashboard,
  Menu,
  Moon,
  Sun,
  WandSparkles,
  X,
} from "lucide-react";

export type AppView = "generate" | "dashboard" | "product-standards" | "knowledge" | "review" | "export";

type AppShellProps = {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  projectName?: string;
  children: ReactNode;
};

const navItems = [
  { id: "generate", label: "Generate Draft", icon: WandSparkles, primary: true },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "knowledge", label: "Knowledge Base", icon: Database },
] satisfies Array<{ id: AppView; label: string; icon: typeof LayoutDashboard; primary?: boolean }>;

export function AppShell({
  activeView,
  onNavigate,
  projectName,
  children,
}: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    try {
      localStorage.setItem("ai-fmea-theme", isDark ? "dark" : "light");
    } catch {
      // Keep theme switching functional when storage is unavailable.
    }

    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    themeMeta?.setAttribute("content", isDark ? "#121212" : "#f0f4f9");
  }, [isDark]);

  const toggleTheme = () => setIsDark((current) => !current);

  return (
    <div className="min-h-screen bg-[var(--c-surface-base)] text-steel-900 dark:text-steel-50">
      {/* ── Desktop Sidebar ── */}
      <aside className={`no-print fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-steel-200 bg-white transition-all duration-300 dark:border-steel-800 dark:bg-steel-900 lg:flex ${
        sidebarCollapsed ? 'w-[72px]' : 'w-[260px]'
      }`}>
        {/* Accent gradient bar at very top */}
        <div className="h-[3px] w-full bg-gradient-to-r from-accent-500 via-purple-500 to-pink-400" />

        {/* Logo area */}
        <div className={`flex items-center gap-3 px-5 py-5 transition-all duration-300 ${
          sidebarCollapsed ? 'justify-center' : ''
        }`}>
          {!sidebarCollapsed ? (
            <>
              <img 
                src="/mattel-logo.svg" 
                alt="Mattel" 
                className="h-8 w-auto dark:brightness-0 dark:invert"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-steel-400 dark:text-steel-500">
                  Design Thinking
                </div>
                <div className="text-sm font-bold text-steel-900 dark:text-white">AI FMEA Tooling</div>
              </div>
            </>
          ) : (
            <img 
              src="/mattel-logo.svg" 
              alt="Mattel" 
              className="h-7 w-auto dark:brightness-0 dark:invert"
            />
          )}
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-steel-200 dark:bg-steel-700" />

        {/* Navigation */}
        <nav className="dark-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;

            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                type="button"
                onClick={() => onNavigate(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-all duration-200 ${
                  sidebarCollapsed ? 'justify-center' : ''
                } ${
                  isActive
                    ? "bg-steel-100 text-steel-900 dark:bg-steel-800 dark:text-white"
                    : "text-steel-500 hover:bg-steel-50 hover:text-steel-900 dark:text-steel-400 dark:hover:bg-steel-800/50 dark:hover:text-steel-200"
                }`}
              >
                {/* Active indicator bar */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent-500" />
                )}
                <Icon size={18} className={isActive ? "text-accent-500" : "text-steel-400 group-hover:text-steel-600 dark:text-steel-500 dark:group-hover:text-steel-300"} />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>
        
        {/* Theme Toggle & Project Indicator */}
        <div className="border-t border-steel-200 p-4 dark:border-steel-700">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
            aria-pressed={isDark}
            title={sidebarCollapsed ? (isDark ? "Light Mode" : "Dark Mode") : undefined}
            className={`group mb-4 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-steel-600 transition-all duration-200 hover:bg-steel-50 hover:text-steel-900 dark:text-steel-400 dark:hover:bg-steel-800/50 dark:hover:text-steel-200 ${
              sidebarCollapsed ? 'justify-center' : ''
            }`}
          >
            {isDark ? (
              <Sun size={18} className="text-steel-400 group-hover:text-steel-500 dark:text-steel-500 dark:group-hover:text-steel-300" />
            ) : (
              <Moon size={18} className="text-steel-400 group-hover:text-steel-500 dark:text-steel-500 dark:group-hover:text-steel-300" />
            )}
            {!sidebarCollapsed && (isDark ? "Light Mode" : "Dark Mode")}
          </button>

          {!sidebarCollapsed && projectName && (
            <div>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-500" />
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-steel-500 dark:text-steel-400">
                  Active Project
                </span>
              </div>
              <div className="mt-1.5 truncate text-sm font-semibold text-steel-800 dark:text-steel-300" title={projectName}>
                {projectName}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Toggle Button */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute -right-3 top-20 z-40 flex h-6 w-6 items-center justify-center rounded-full border border-steel-200 bg-white text-steel-600 shadow-md transition-all duration-200 hover:bg-steel-50 hover:text-steel-900 dark:border-steel-700 dark:bg-steel-800 dark:text-steel-400 dark:hover:bg-steel-700 dark:hover:text-steel-200"
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>

      {/* ── Main content area ── */}
      <div className={`transition-all duration-300 ${sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-[260px]'}`}>
        {/* Top header — glassmorphism */}
        <header className="no-print sticky top-0 z-20 border-b border-steel-200/60 backdrop-blur-md bg-white/80 dark:bg-steel-900/80 dark:border-steel-700/60">
          <div className="flex min-h-[60px] items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              {/* Mobile menu toggle */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-steel-900 text-white transition hover:bg-steel-800 dark:bg-steel-700 dark:hover:bg-steel-600 lg:hidden"
              >
                {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
              <div>
                <h1 className="text-lg font-bold text-steel-900 dark:text-white">
                  {navItems.find((n) => n.id === activeView)?.label ?? "Dashboard"}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Theme control remains available when the desktop sidebar is hidden. */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
                aria-pressed={isDark}
                title={isDark ? "Light Mode" : "Dark Mode"}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-steel-200 bg-white text-steel-600 shadow-xs transition-colors hover:bg-steel-100 hover:text-steel-900 dark:border-steel-700 dark:bg-steel-800 dark:text-steel-300 dark:hover:bg-steel-700 dark:hover:text-white lg:hidden"
              >
                {isDark ? <Sun size={17} /> : <Moon size={17} />}
              </button>

              {/* Subtle project badge in header */}
              {projectName ? (
                <div className="hidden items-center gap-2 rounded-full border border-steel-200 bg-white px-3 py-1.5 text-xs font-medium text-steel-600 shadow-xs sm:flex dark:border-steel-700 dark:bg-steel-800 dark:text-steel-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                  <span className="max-w-[200px] truncate">{projectName}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Mobile nav — wrapping pill tabs */}
          {mobileMenuOpen && (
            <div className="animate-slide-down flex flex-wrap gap-1.5 border-t border-steel-100 px-4 py-3 dark:border-steel-800 lg:hidden">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    onClick={() => {
                      onNavigate(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      isActive
                        ? "bg-accent-500 text-white shadow-sm"
                        : "bg-steel-100 text-steel-600 hover:bg-steel-200 dark:bg-steel-800 dark:text-steel-300 dark:hover:bg-steel-700"
                    }`}
                  >
                    <Icon size={14} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        <main className="animate-fade-in px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
