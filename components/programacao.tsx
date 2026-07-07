"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, RotateCcw, Loader2, RefreshCw, Zap } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { getProgramacaoAction, renumerarLotesAction, sincronizarFilaAction, type LoteProgramacao } from "@/app/actions/lotes";
import { LOTE_CAPACITY, selecionarProximoLoteSequencial } from "@/lib/lote-queue";
import { SectionHeader } from "./section-header";

// ---------------------------------------------------------------------------
// Badge "DA VEZ"
// ---------------------------------------------------------------------------
function DaVezBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500 bg-yellow-500/10 px-2.5 py-0.5 text-xs font-bold text-yellow-400">
      <Zap size={10} />
      PRÓXIMO
    </span>
  );
}

// ---------------------------------------------------------------------------
// Barra de progresso de ativos
// ---------------------------------------------------------------------------
function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color =
    pct === 100 ? "bg-app-green" :
    pct >= 50   ? "bg-app-green" :
    pct > 0     ? "bg-yellow-400" :
    "bg-app-border";

  return (
    <div className="h-1.5 w-full rounded-full bg-app-border overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card de lote na fila
// ---------------------------------------------------------------------------
function LoteCard({
  lote,
  isProximo
}: {
  lote: LoteProgramacao;
  isProximo: boolean;
}) {
  // PRÓXIMO é o lote seguinte na sequência circular (1, 2, 3, ..., N, 1, ...)
  // a partir de onde a fila parou — nunca só a posição 1.
  const isDaVez = isProximo;

  return (
    <div
      className={`rounded-lg border p-4 transition ${
        isDaVez
          ? "border-yellow-500/60 bg-yellow-500/5"
          : "border-app-border bg-app-panel"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Posição */}
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-sm font-bold ${
            isDaVez
              ? "border-yellow-500 bg-yellow-500/10 text-yellow-400"
              : "border-app-border bg-app-card text-app-muted"
          }`}
        >
          {lote.posicao}º
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="font-semibold text-app-white">{lote.nome}</span>
            {isDaVez ? <DaVezBadge /> : null}
          </div>

          {/* Contadores */}
          <div className="flex items-center gap-4 text-xs text-app-muted mb-2">
            <span>
              <span className="font-bold text-app-green">{lote.veiculos_ativos}</span>
              {" "}ativos
            </span>
            <span>
              <span className="font-bold text-app-white">{lote.total_veiculos}</span>
              {" "}/ {LOTE_CAPACITY} total
            </span>
          </div>

          {/* Barra de ativos */}
          <ProgressBar value={lote.veiculos_ativos} max={LOTE_CAPACITY} />
        </div>

        {/* Contador grande de ativos */}
        <div className="shrink-0 text-right">
          <p
            className={`text-2xl font-bold tabular-nums leading-none ${
              lote.veiculos_ativos > 0 ? "text-app-green" : "text-app-border"
            }`}
          >
            {lote.veiculos_ativos}
          </p>
          <p className="mt-0.5 text-xs text-app-muted">ativos</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function Programacao() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [lotes, setLotes] = useState<LoteProgramacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [renumerando, setRenumerando] = useState(false);

  const load = useCallback(async () => {
    const result = await getProgramacaoAction();
    setLotes(result.data);
    setCarregando(false);
  }, []);

  // No mount: sincroniza o flag lote_da_vez com o topo da fila ordenada,
  // depois carrega. Garante que o banco reflita a ordem real.
  useEffect(() => {
    async function syncAndLoad() {
      await sincronizarFilaAction();
      await load();
    }
    void syncAndLoad();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualiza em tempo real quando lotes ou veículos mudarem
  useEffect(() => {
    const channel = supabase
      .channel("programacao-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "lotes" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "veiculos" }, () => {
        void load();
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [supabase, load]);

  async function handleRefresh() {
    setAtualizando(true);
    await load();
    setAtualizando(false);
  }

  async function handleRenumerar() {
    setRenumerando(true);
    await renumerarLotesAction();
    await sincronizarFilaAction();
    await load();
    setRenumerando(false);
  }

  const totalAtivos = lotes.reduce((s, l) => s + l.veiculos_ativos, 0);
  const totalVeiculos = lotes.reduce((s, l) => s + l.total_veiculos, 0);
  // Próximo = próximo elegível na sequência circular (1, 2, 3, ..., N, 1, ...)
  // a partir do lote_da_vez, nunca só o de maior volume.
  const ativosPorId = useMemo(() => new Map(lotes.map((l) => [l.id, l.veiculos_ativos])), [lotes]);
  const proxLote = selecionarProximoLoteSequencial(lotes, ativosPorId) ?? undefined;

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Programação de Disparo"
          description="Fila circular pela sequência numérica dos lotes (1, 2, 3, ..., N, 1, ...). Lotes esgotados são pulados até voltarem a ter veículos ativos."
        />
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={handleRenumerar}
            disabled={renumerando || carregando}
            title="Renomeia os lotes em ordem de criação, fechando buracos e duplicatas na numeração"
            className="flex items-center gap-2 rounded-md border border-app-border bg-app-card px-3 py-2 text-sm font-semibold text-app-muted hover:text-app-white disabled:opacity-50 transition"
          >
            <RotateCcw size={14} className={renumerando ? "animate-spin" : ""} />
            Renumerar lotes
          </button>
          <button
            onClick={handleRefresh}
            disabled={atualizando || carregando}
            className="flex items-center gap-2 rounded-md border border-app-border bg-app-card px-3 py-2 text-sm font-semibold text-app-muted hover:text-app-white disabled:opacity-50 transition"
          >
            <RefreshCw size={14} className={atualizando ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-app-border bg-app-panel p-3">
          <p className="text-xs text-app-muted">Total de lotes</p>
          <p className="mt-1 text-2xl font-bold text-app-white">{lotes.length}</p>
        </div>
        <div className="rounded-lg border border-app-border bg-app-panel p-3">
          <p className="text-xs text-app-muted">Veículos ativos</p>
          <p className="mt-1 text-2xl font-bold text-app-green">{totalAtivos}</p>
        </div>
        <div className="rounded-lg border border-app-border bg-app-panel p-3">
          <p className="text-xs text-app-muted">Total cadastrados</p>
          <p className="mt-1 text-2xl font-bold text-app-white">{totalVeiculos}</p>
        </div>
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3">
          <p className="text-xs text-app-muted">Próximo disparo</p>
          <p className="mt-1 truncate text-sm font-bold text-yellow-400">
            {proxLote?.nome ?? "—"}
          </p>
        </div>
      </div>

      {/* Fila */}
      {carregando ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-app-muted" />
        </div>
      ) : lotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-app-border py-20 text-center">
          <CalendarClock size={40} className="mb-4 text-app-border" />
          <p className="font-semibold text-app-white">Nenhum lote cadastrado</p>
          <p className="mt-1 text-sm text-app-muted">
            Cadastre anúncios para que os lotes apareçam aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-app-muted px-1">
            <span className="font-semibold">ORDEM DE DISPARO</span>
            <span className="text-app-border">—</span>
            <span>sequência numérica dos lotes, em loop</span>
          </div>
          {lotes.map((lote) => (
            <LoteCard key={lote.id} lote={lote} isProximo={proxLote?.id === lote.id} />
          ))}
        </div>
      )}
    </section>
  );
}
