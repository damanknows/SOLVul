// src/web/components/NavBar.tsx
import Link from "next/link";
import { useRouter } from "next/router";

function useSafePathname(): string {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const router = useRouter();
    return router?.pathname || "";
  } catch {
    return "";
  }
}

export default function NavBar() {
  const pathname = useSafePathname();

  const navItems = [
    { href: "/", label: "Home" },
    { href: "/inspector", label: "Inspector" },
    { href: "/overview", label: "Overview" },
    { href: "/risk-report", label: "Risk Report" },
    { href: "/settings", label: "Settings" },
  ];

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50 shadow-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Link
            href="/"
            className="flex items-center space-x-2 text-white font-bold text-lg tracking-tight hover:text-indigo-400 transition-colors"
          >
            <span className="text-xl">🛡️</span>
            <span>SOLVul</span>
            <span className="hidden sm:inline-block text-[10px] uppercase font-mono font-bold bg-indigo-600/70 text-indigo-200 border border-indigo-400/40 px-2 py-0.5 rounded-full">
              SVM Firewall
            </span>
          </Link>
        </div>
        <nav className="flex items-center space-x-1 sm:space-x-2 text-sm font-medium">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm transition-all duration-150 ${
                  isActive
                    ? "bg-indigo-600 text-white font-semibold shadow-xs"
                    : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
