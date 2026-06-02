"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Car, ClipboardList, Layers, ListChecks, LogOut, MessageCircle, PlusCircle, Smartphone, Timer, Users } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

const TOTAL_SECONDS = 60 * 60;

const navItems = [
  { href: "/dashboard/anuncio", label: "Cadastrar Anuncio", icon: PlusCircle },
  { href: "/dashboard/veiculos", label: "Lista de Veiculos", icon: Car },
  { href: "/dashboard/programacao", label: "Programação", icon: CalendarClock },
  { href: "/dashboard/grupos", label: "Grupos", icon: MessageCircle },
  { href: "/dashboard/whatsapp", label: "Conectar WhatsApp", icon: Smartphone }
];

const adminNavItems = [
  { href: "/dashboard/admin", label: "Usuários", icon: Users },
  { href: "/dashboard/logs", label: "Logs", icon: ClipboardList }
];

// ---------------------------------------------------------------------------
// CountdownTimer — componente puro de exibição (sem lógica de estado própria)
// ---------------------------------------------------------------------------
function CountdownTimer({
  seconds,
  firing,
  compact = false
}: {
  seconds: number;
  firing: boolean;
  compact?: boolean;
}) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  const display = `${minutes}:${secs}`;

  const colorClass =
    seconds > 600 ? "text-app-green"
    : seconds > 300 ? "text-yellow-400"
    : seconds > 60  ? "text-orange-400"
    : "text-red-400";

  const progress = seconds / TOTAL_SECONDS;
  const circumference = 2 * Math.PI * 18;
  const dashOffset = circumference * (1 - progress);

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 text-sm font-bold tabular-nums ${colorClass}`}>
        <Timer size={14} />
        <span>{firing ? "..." : display}</span>
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
              cx="22" cy="22" r="18"
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

// ---------------------------------------------------------------------------
// DashboardShell — toda a lógica do timer vive aqui (instância única)
// ---------------------------------------------------------------------------
export function DashboardShell({
  children,
  userEmail,
  isAdmin = false
}: {
  children: React.ReactNode;
  userEmail: string;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // --- timer ---
  const [timerSeconds, setTimerSeconds] = useState(TOTAL_SECONDS);
  const [timerFiring] = useState(false);
  const nextAtRef    = useRef<number | null>(null);
  const nextAtIsoRef = useRef<string | null>(null);
  // Evita que o browser resete o timer mais de uma vez seguida
  const resetingRef  = useRef(false);

  // 1. Busca o timestamp global do Supabase ao montar
  useEffect(() => {
    async function init() {
      try {
        const { data, error } = await supabase
          .from("dispatch_config")
          .select("next_dispatch_at")
          .eq("id", 1)
          .maybeSingle();

        if (error) throw error;

        if (data?.next_dispatch_at) {
          const iso = data.next_dispatch_at as string;
          const ts  = new Date(iso).getTime();
          if (Number.isFinite(ts)) {
            nextAtRef.current    = ts;
            nextAtIsoRef.current = iso;
            setTimerSeconds(Math.max(0, Math.round((ts - Date.now()) / 1000)));
            return;
          }
        }
      } catch (err) {
        console.warn("[EazyPost] dispatch_config não encontrado, usando timer local:", err);
      }
      // Fallback: sem linha no banco ainda
      nextAtRef.current    = Date.now() + TOTAL_SECONDS * 1000;
      nextAtIsoRef.current = null; // sem ISO → claim atômico desabilitado neste fallback
      setTimerSeconds(TOTAL_SECONDS);
    }
    void init();
  }, [supabase]);

  // 2. Real-time: sincroniza todos os browsers quando qualquer um disparar
  useEffect(() => {
    const channel = supabase
      .channel("dispatch-config-rt")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "dispatch_config" },
        (payload) => {
          try {
            const raw = (payload.new as Record<string, unknown>).next_dispatch_at;
            const iso = raw as string;
            const ts  = new Date(iso).getTime();
            if (!Number.isFinite(ts)) return;
            nextAtRef.current    = ts;
            nextAtIsoRef.current = iso;
            setTimerSeconds(Math.max(0, Math.round((ts - Date.now()) / 1000)));
          } catch {
            // ignora payload malformado
          }
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [supabase]);

  // 3. Tick de countdown — ao chegar em 0 o browser reseta o timer no banco.
  // O WEBHOOK não é disparado aqui — fica exclusivamente com o cron (n8n).
  useEffect(() => {
    if (nextAtRef.current === null) return;

    if (timerSeconds > 0) {
      const id = setTimeout(() => {
        const remaining = Math.max(0, Math.round(((nextAtRef.current ?? 0) - Date.now()) / 1000));
        setTimerSeconds(remaining);
      }, 1000);
      return () => clearTimeout(id);
    }

    // Chegou em 0: reseta o next_dispatch_at no banco para que todos os browsers
    // avancem para o próximo ciclo. O webhook é responsabilidade do cron.
    if (resetingRef.current) return;
    resetingRef.current = true;

    const newNextTs  = Date.now() + TOTAL_SECONDS * 1000;
    const newNextIso = new Date(newNextTs).toISOString();
    const currentIso = nextAtIsoRef.current;

    async function resetTimer() {
      if (currentIso) {
        // Claim atômico: só o primeiro browser que chegar reseta
        const { data: claimed } = await supabase
          .from("dispatch_config")
          .update({ next_dispatch_at: newNextIso })
          .eq("id", 1)
          .eq("next_dispatch_at", currentIso)
          .select("id");

        if (!claimed || claimed.length === 0) {
          // Outro browser já resetou — aguarda o real-time atualizar
          resetingRef.current = false;
          return;
        }
      } else {
        await supabase
          .from("dispatch_config")
          .update({ next_dispatch_at: newNextIso })
          .eq("id", 1);
      }

      nextAtRef.current    = newNextTs;
      nextAtIsoRef.current = newNextIso;
      setTimerSeconds(TOTAL_SECONDS);
      resetingRef.current = false;
    }

    void resetTimer();
  }, [timerSeconds, supabase]);

  // --- próximo lote ---
  const [proxLote, setProxLote] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProxLote() {
      // Usa o mesmo critério de ordenação do getProgramacaoAction:
      // ativos DESC → total DESC → created_at ASC
      const [veiculosResult, totalResult, lotesResult] = await Promise.all([
        supabase.from("veiculos").select("lote_id").eq("status", "ativo").not("lote_id", "is", null),
        supabase.from("veiculos").select("lote_id").not("lote_id", "is", null),
        supabase.from("lotes").select("id, nome, created_at").neq("nome", "Vendidos").order("created_at", { ascending: true })
      ]);

      const lotes = (lotesResult.data ?? []) as { id: string; nome: string; created_at: string }[];
      if (!lotes.length) { setProxLote(null); return; }

      // Conta ativos e totais por lote
      const ativosMap = new Map<string, number>();
      const totalMap  = new Map<string, number>();

      (veiculosResult.data ?? [] as { lote_id: string }[]).forEach((v) => {
        const lid = (v as { lote_id: string }).lote_id;
        ativosMap.set(lid, (ativosMap.get(lid) ?? 0) + 1);
      });
      (totalResult.data ?? [] as { lote_id: string }[]).forEach((v) => {
        const lid = (v as { lote_id: string }).lote_id;
        totalMap.set(lid, (totalMap.get(lid) ?? 0) + 1);
      });

      // Ordena igual à fila: ativos DESC → total DESC → created_at ASC
      const sorted = [...lotes].sort((a, b) => {
        const diffAtivos = (ativosMap.get(b.id) ?? 0) - (ativosMap.get(a.id) ?? 0);
        if (diffAtivos !== 0) return diffAtivos;
        const diffTotal = (totalMap.get(b.id) ?? 0) - (totalMap.get(a.id) ?? 0);
        if (diffTotal !== 0) return diffTotal;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      // Topo da fila com pelo menos 1 ativo
      const top = sorted.find((l) => (ativosMap.get(l.id) ?? 0) > 0) ?? sorted[0];
      setProxLote(top?.nome ?? null);
    }
    void fetchProxLote();

    const channel = supabase
      .channel("lotes-dispatch-shell")
      .on("postgres_changes", { event: "*", schema: "public", table: "lotes" }, () => {
        void fetchProxLote();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "veiculos" }, () => {
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

        <CountdownTimer seconds={timerSeconds} firing={timerFiring} />

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
          {isAdmin ? (
            <>
              <div className="my-2 border-t border-app-border" />
              {adminNavItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-md border px-3 py-3 text-sm font-semibold transition ${
                      active
                        ? "border-yellow-500 bg-app-card text-yellow-400"
                        : "border-transparent text-app-muted hover:border-app-border hover:text-app-white"
                    }`}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </>
          ) : null}
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
            <CountdownTimer seconds={timerSeconds} firing={timerFiring} compact />
            <button onClick={handleLogout} className="rounded-md border border-app-border bg-app-card p-2 text-app-white">
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <nav className={`grid gap-1.5 ${isAdmin ? "grid-cols-6" : "grid-cols-5"}`}>
          {[...navItems, ...(isAdmin ? adminNavItems : [])].map((item) => {
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
