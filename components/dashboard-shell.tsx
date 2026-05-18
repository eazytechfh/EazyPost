"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { Car, ListChecks, LogOut, MessageCircle, PlusCircle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

const navItems = [
  {
    href: "/dashboard/anuncio",
    label: "Cadastrar Anuncio",
    icon: PlusCircle
  },
  {
    href: "/dashboard/veiculos",
    label: "Lista de Veiculos",
    icon: Car
  },
  {
    href: "/dashboard/grupos",
    label: "Grupos",
    icon: MessageCircle
  }
];

export function DashboardShell({
  children,
  userEmail
}: {
  children: React.ReactNode;
  userEmail: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-app-black text-app-white">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-app-border bg-app-panel p-5 lg:block">
        <Link href="/dashboard/anuncio" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-app-green text-app-black">
            <ListChecks size={22} />
          </span>
          <div>
            <p className="text-lg font-bold text-app-white">Eazy<span className="text-app-green">Post</span></p>
            <p className="text-xs text-app-muted">{userEmail}</p>
          </div>
        </Link>

        <nav className="mt-10 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-md border px-3 py-3 text-sm font-semibold transition ${
                  active
                    ? "border-app-green bg-app-card text-app-green"
                    : "border-transparent text-app-muted hover:border-app-border hover:text-app-white"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button onClick={handleLogout} className="app-button-secondary absolute bottom-5 left-5 right-5">
          <LogOut size={18} />
          Sair
        </button>
      </aside>

      <header className="sticky top-0 z-20 border-b border-app-border bg-app-panel px-4 py-3 lg:hidden">
        <div className="mb-3 flex items-center justify-between">
          <Link href="/dashboard/anuncio" className="text-lg font-bold">
            Eazy<span className="text-app-green">Post</span>
          </Link>
          <button onClick={handleLogout} className="rounded-md border border-app-border bg-app-card p-2 text-app-white">
            <LogOut size={18} />
          </button>
        </div>
        <nav className="grid grid-cols-3 gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                className={`flex h-11 items-center justify-center rounded-md border transition ${
                  active ? "border-app-green text-app-green" : "border-app-border text-app-muted"
                }`}
              >
                <Icon size={18} />
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="px-4 py-6 lg:ml-72 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
