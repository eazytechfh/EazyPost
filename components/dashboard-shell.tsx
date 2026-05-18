"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Car, ListChecks, LogOut, MessageCircle, PlusCircle, Timer } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

const WEBHOOK_URL = "https://n8n.eazy.tec.br/webhook/4b4ea55a-7916-4592-b44c-875fc13d7064";
const TOTAL_SECONDS = 60 * 60;
const STORAGE_KEY = "eazypost_next_dispatch";

function getOrInitNextDispatch(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const next = Number(stored);
      if (Number.isFinite(next) && next > Date.now()) {
        return next;
      }
    }
  } catch {
    // localStorage indisponível (SSR ou modo privado restrito)
  }
  const next = Date.now() + TOTAL_SECONDS * 1000;
  try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* ignore */ }
  return next;
}

function saveNextDispatch(next: number) {
  try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* ignore */ }
}

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

function useCountdown() {
  const [seconds, setSeconds] = useState(() => {
    if (typeof window === "undefined") return TOTAL_SECONDS;
    return Math.max(0, Math.round((getOrInitNextDispatch() - Date.now()) / 1000));
  });
  const [firing, setFiring] = useState(false);
  const firingRef = useRef(false);

  useEffect(() => {
    if (seconds > 0) {
      const timer = setTimeout(() => {
        setSeconds(Math.max(0, Math.round((getOrInitNextDispatch() - Date.now()) / 1000)));
      }, 1000);
      return () => clearTimeout(timer);
    }

    if (firingRef.current) return;
    firingRef.current = true;
    setFiring(true);

    fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disparar: "ok" })
    })
      .catch((err) => console.error("Erro ao disparar webhook:", err))
      .finally(() => {
        const next = Date.now() + TOTAL_SECONDS * 1000;
        saveNextDispatch(next);
        firingRef.current = false;
        setFiring(false);
        setSeconds(TOTAL_SECONDS);
      });
  }, [seconds]);

  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  const display = `${minutes}:${secs}`;

  const colorClass =
    seconds > 600
      ? "text-app-green"
      : seconds > 300
      ? "text-yellow-400"
      : seconds > 60
      ? "text-orange-400"
      : "text-red-400";

  const progress = seconds / TOTAL_SECONDS;

  return { display, colorClass, firing, progress, seconds };
}

function CountdownTimer({ compact = false }: { compact?: boolean }) {
  const { display, colorClass, firing, progress } = useCountdown();

  const circumference = 2 * Math.PI * 18;
  const dashOffset = circumference * (1 - progress);

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 text-sm font-bold tabular-nums ${colorClass}`}>
        <Timer size={14} />
        <span>{display}</span>
        {firing ? <span className="text-xs text-app-muted">●</span> : null}
      </div>
    );
  }

  return (
    <div className="mx-0 my-4 rounded-md border border-app-border bg-app-card p-3">
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
            <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="3" className="text-app-border" />
            <circle
              cx="22"
              cy="22"
              r="18"
              fill="none"
              strokeWidth="3"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              className={`transition-all duration-1000 ${colorClass}`}
            />
          </svg>
          <Timer size={14} className={`absolute inset-0 m-auto ${colorClass}`} />
        </div>
        <div className="min-w-0">
          <p className={`text-xl font-bold tabular-nums leading-none ${colorClass}`}>
            {firing ? "Disparando..." : display}
          </p>
          <p className="mt-1 text-xs text-app-muted">Próximo disparo</p>
        </div>
      </div>
    </div>
  );
}

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

        <CountdownTimer />

        <nav className="space-y-2">
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
          <div className="flex items-center gap-3">
            <CountdownTimer compact />
            <button onClick={handleLogout} className="rounded-md border border-app-border bg-app-card p-2 text-app-white">
              <LogOut size={18} />
            </button>
          </div>
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
