"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/calendar", label: "Calendar" },
  { href: "/posts", label: "Posts" },
  { href: "/slots", label: "Slots" },
];

export function Nav({ timezone }: { timezone: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/calendar" className="text-sm font-semibold tracking-tight">
          Cadence
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-neutral-400 sm:inline">{timezone}</span>
          <button onClick={signOut} className="btn-ghost">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
