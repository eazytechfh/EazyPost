"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Car, Layers, ListChecks, LogOut, MessageCircle, PlusCircle, Timer } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

const WEBHOOK_URL = "https://n8n.eazy.tec.br/webhook/4b4ea55a-7916-4592-b44c-875fc13d7064";
const TOTAL_SECONDS = 60 * 60;

/**
 * Dispara o webhook com até 4 tentativas (backoff: 0s → 3s → 7s → 15s).
 * Sempre resolve (nunca rejeita) para que o timer resete mesmo em falha total.
 */
async function tryFireWebhook(): Promise<void> {
  const retryDelays = [0, 3000, 7000, 15000];
  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (retryDelays[attempt] > 0) {
      await new Promise<void>((r) => setTimeout(r, retryDelays[attempt]));
    }
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disparar: "ok" })
      });
      if (res.ok) {
        console.info(`[EazyPost] Webhook disparado (tentativa ${attempt + 1})`);
        return;
      }
      console.warn(`[EazyPost] Webhook HTTP ${res.status} — tentativa ${attempt + 1}/${retryDelays.length}`);
    } catch (err) {
      console.warn(`[EazyPost] Webhook erro — tentativa ${attempt + 1}/${retryDelays.length}:`, err);
    }
  }
  console.error("[EazyPost] Webhook falhou após todas as tentativas — timer será resetado mesmo assim.");
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

/**
 * Fonte de verdade: tabela dispatch_config no Supabase (id=1, next_dispatch_at).
 * Todos os browsers leem o mesmo timestamp — real-time sincroniza qualquer mudança.
 * Quando o timer chega em 00:00 num browser:
 *   1. Dispara o webhook (com retry)
 *   2. Grava novo next_dispatch_at no Supabase
 *   3. O real-time propaga para TODOS os outros browsers imediatamente
 */
function useCountdown() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  // null = ainda carregando do banco
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(TOTAL_SECONDS);
  const [firing, setFiring] = useState(false);
  const firingRef = useRef(false);

  // 1. Busca o timestamp global do Supabase ao montar
  useEffect(() => {
    async function init() {
      const { data } = await supabase
        .from("dispatch_config")
        .select("next_dispatch_at")
        .eq("id", 1)
        .maybeSingle();

      if (data?.next_dispatch_at) {
        const ts = new Date(data.next_dispatch_at as string).getTime();
        setNextAt(ts);
        setSeconds(Math.max(0, Math.round((ts - Date.now()) / 1000)));
      } else {
        // Tabela ainda não configurada — começa timer local como fallback
        setNextAt(Date.now() + TOTAL_SECONDS * 1000);
        setSeconds(TOTAL_SECONDS);
      }
    }
    void init();
  }, [supabase]);

  // 2. Real-time: qualquer browser que disparar atualiza todos os outros
  useEffect(() => {
    const channel = supabase
      .channel("dispatch-config-rt")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "dispatch_config" },
        (payload) => {
          const ts = new Date(payload.new.next_dispatch_at as string).getTime();
          setNextAt(ts);
          setSeconds(Math.max(0, Math.round((ts - Date.now()) / 1000)));
          firingRef.current = false;
          setFiring(false);
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [supabase]);

  // 3. Tick de countdown + disparo ao chegar em 0
  useEffect(() => {
    if (nextAt === null) return; // aguarda init

    if (seconds > 0) {
      const id = setTimeout(() => {
        setSeconds(Math.max(0, Math.round((nextAt - Date.now()) / 1000)));
      }, 1000);
      return () => clearTimeout(id);
    }

    if (firingRef.current) return;
    firingRef.current = true;
    setFiring(true);

    const newNext = Date.now() + TOTAL_SECONDS * 1000;

    async function fire() {
      await tryFireWebhook();
      // Grava no Supabase — o real-time propaga para todos os outros browsers
      await supabase
        .from("dispatch_config")
        .update({ next_dispatch_at: new Date(newNext).toISOString() })
        .eq("id", 1);
    }

    void fire().finally(() => {
      // Atualiza localmente também (caso real-time demore)
      setNextAt(newNext);
      setSeconds(TOTAL_SECONDS);
      firingRef.current = false;
      setFiring(false);
    });
  }, [seconds, nextAt, supabase]);

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
  const [proxLote, setProxLote] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProxLote() {
      const { data } = await supabase
        .from("lotes")
        .select("nome")
        .eq("lote_da_vez", true)
        .maybeSingle();
      setProxLote(data?.nome ?? null);
    }
    void fetchProxLote();

    const channel = supabase
      .channel("lotes-dispatch-shell")
      .on("postgres_changes", { event: "*", schema: "public", table: "lotes" }, () => {
        void fetchProxLote();
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [supabase]);

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

        <div className="mb-4 rounded-md border border-app-border bg-app-card px-3 py-2.5">
          <p className="text-xs text-app-muted">Próximo lote de disparo</p>
          {proxLote ? (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm font-bold text-app-green">
              <Layers size={12} className="shrink-0" />
              {proxLote}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-app-muted">—</p>
          )}
        </div>

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
