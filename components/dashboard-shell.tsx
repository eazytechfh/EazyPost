"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Car, ClipboardList, Layers, ListChecks, LogOut, MessageCircle, PlusCircle, Smartphone, Timer, Users } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { calcularStatusDisparo, ordenarLotesPorNumero, selecionarProximoLoteSequencial } from "@/lib/lote-queue";

const TOTAL_SECONDS = 60 * 60;
const HORAS_PERMITIDAS_PADRAO = [9, 10, 13, 14, 15, 16, 17];

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
  status,
  compact = false
}: {
  status: import("@/lib/lote-queue").StatusDisparo;
  compact?: boolean;
}) {
  const horaFormatada = `${String(status.proximaHora).padStart(2, "0")}:00`;

  if (status.modo === "aguardando") {
    if (compact) {
      return (
        <div className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-app-muted">
          <Timer size={14} />
          <span>{horaFormatada}</span>
        </div>
      );
    }
    return (
      <div className="mx-0 my-4 rounded-md border border-app-border bg-app-card p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-app-border text-app-muted">
            <Timer size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-xl font-bold tabular-nums leading-none text-app-muted">{horaFormatada}</p>
            <p className="mt-1 text-xs text-app-muted">Próximo horário de disparo</p>
          </div>
        </div>
      </div>
    );
  }

  const seconds = status.segundosRestantes;
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
        <span>{display}</span>
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
          <p className={`text-xl font-bold tabular-nums leading-none ${colorClass}`}>{display}</p>
          <p className="mt-1 text-xs text-app-muted">Próximo disparo às {horaFormatada}</p>
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
  // O browser NUNCA dispara o webhook. O status exibido (contagem regressiva
  // ou "aguardando próximo horário") é calculado 100% no cliente a partir dos
  // horários permitidos e do relógio — o disparo em si é server-side (Vercel Cron).
  const [horasPermitidas, setHorasPermitidas] = useState<number[]>(HORAS_PERMITIDAS_PADRAO);
  const [dispatchStatus, setDispatchStatus] = useState(() =>
    calcularStatusDisparo(HORAS_PERMITIDAS_PADRAO, new Date())
  );

  // 1. Lê os horários permitidos do banco ao montar
  useEffect(() => {
    async function init() {
      try {
        const { data } = await supabase
          .from("dispatch_config")
          .select("horas_permitidas")
          .eq("id", 1)
          .maybeSingle();

        if (data?.horas_permitidas?.length) {
          setHorasPermitidas(data.horas_permitidas as number[]);
        }
      } catch (err) {
        console.warn("[EazyPost] Erro ao ler dispatch_config:", err);
      }
    }
    void init();
  }, [supabase]);

  // 2. Real-time: se o admin alterar os horários permitidos, todos os
  //    browsers abertos recebem a atualização automaticamente.
  useEffect(() => {
    const channel = supabase
      .channel("dispatch-config-rt")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "dispatch_config" },
        (payload) => {
          const raw = (payload.new as Record<string, unknown>).horas_permitidas;
          if (Array.isArray(raw) && raw.length) {
            setHorasPermitidas(raw as number[]);
          }
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [supabase]);

  // 3. Tick de 1s — recalcula o status (contagem ou aguardando) a cada segundo
  useEffect(() => {
    const id = setInterval(() => {
      setDispatchStatus(calcularStatusDisparo(horasPermitidas, new Date()));
    }, 1000);
    return () => clearInterval(id);
  }, [horasPermitidas]);

  // --- próximo lote ---
  const [proxLote, setProxLote] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProxLote() {
      // Usa o mesmo critério da fila circular do cron: sequência numérica
      // do lote (1, 2, 3, ...), avançando a partir do lote_da_vez.
      const [veiculosResult, lotesResult] = await Promise.all([
        supabase.from("veiculos").select("lote_id").eq("status", "ativo").not("lote_id", "is", null),
        supabase.from("lotes").select("id, nome, lote_da_vez, created_at").neq("nome", "Vendidos")
      ]);

      const lotes = (lotesResult.data ?? []) as { id: string; nome: string; lote_da_vez: boolean; created_at: string }[];
      if (!lotes.length) { setProxLote(null); return; }

      // Conta ativos por lote
      const ativosMap = new Map<string, number>();

      (veiculosResult.data ?? [] as { lote_id: string }[]).forEach((v) => {
        const lid = (v as { lote_id: string }).lote_id;
        ativosMap.set(lid, (ativosMap.get(lid) ?? 0) + 1);
      });

      // Ordena pela sequência numérica do lote (1, 2, 3, ...)
      const sorted = ordenarLotesPorNumero(lotes);

      // Próximo elegível na sequência circular a partir do lote_da_vez
      const proximo = selecionarProximoLoteSequencial(sorted, ativosMap);
      setProxLote(proximo?.nome ?? null);
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

        <CountdownTimer status={dispatchStatus} />

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
            <CountdownTimer status={dispatchStatus} compact />
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
