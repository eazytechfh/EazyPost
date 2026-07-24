"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Search, SendHorizonal } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { moverParaProximoLoteAction } from "@/app/actions/lotes";
import type { Lote, Veiculo } from "@/types/database";
import { SectionHeader } from "./section-header";

type VeiculoComLote = Veiculo & { lote_nome: string | null };

export function Relatorios() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [veiculos, setVeiculos] = useState<VeiculoComLote[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [searchNome, setSearchNome] = useState("");
  const [searchPlaca, setSearchPlaca] = useState("");
  const [filtroLoteId, setFiltroLoteId] = useState("");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");

  const [movingId, setMovingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [veiculosResult, lotesResult] = await Promise.all([
      supabase.from("veiculos").select("*").neq("status", "vendido").order("nome_anuncio", { ascending: true }),
      supabase.from("lotes").select("*").order("created_at", { ascending: true })
    ]);

    const lotesData = (lotesResult.data ?? []) as Lote[];
    const lotesById = new Map(lotesData.map((l) => [l.id, l.nome]));

    const veiculosData = ((veiculosResult.data ?? []) as Veiculo[]).map((v) => ({
      ...v,
      lote_nome: v.lote_id ? lotesById.get(v.lote_id) ?? null : null
    }));

    setLotes(lotesData);
    setVeiculos(veiculosData);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadData();

    const channel = supabase
      .channel("relatorios-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "veiculos" }, () => void loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "lotes" }, () => void loadData())
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [loadData, supabase]);

  const filtrados = useMemo(() => {
    const de = dataDe ? new Date(`${dataDe}T00:00:00`) : null;
    const ate = dataAte ? new Date(`${dataAte}T23:59:59`) : null;

    return veiculos.filter((v) => {
      if (searchNome && !v.nome_anuncio.toLowerCase().includes(searchNome.toLowerCase())) return false;
      if (searchPlaca && !v.placa.toLowerCase().includes(searchPlaca.toLowerCase())) return false;
      if (filtroLoteId && v.lote_id !== filtroLoteId) return false;

      if (de || ate) {
        if (!v.ultimo_envio_em) return false;
        const envio = new Date(v.ultimo_envio_em);
        if (de && envio < de) return false;
        if (ate && envio > ate) return false;
      }

      return true;
    });
  }, [veiculos, searchNome, searchPlaca, filtroLoteId, dataDe, dataAte]);

  async function handleMoverProximoLote(veiculo: VeiculoComLote) {
    setMovingId(veiculo.id);
    setMessage("");
    try {
      const { loteDestino, error } = await moverParaProximoLoteAction(veiculo.id);
      if (error) {
        setMessage(error);
        return;
      }
      setMessage(`Veículo [${veiculo.nome_anuncio}] movido para ${loteDestino?.nome}.`);
      await loadData();
    } finally {
      setMovingId(null);
    }
  }

  function startEdit(veiculo: VeiculoComLote) {
    setEditingId(veiculo.id);
    setEditValue(veiculo.ultimo_envio_em ? toLocalDateTimeInput(veiculo.ultimo_envio_em) : "");
  }

  async function saveEdit(veiculoId: string) {
    setSavingEdit(true);
    try {
      const isoValue = editValue ? new Date(editValue).toISOString() : null;
      const { error } = await supabase
        .from("veiculos")
        .update({ ultimo_envio_em: isoValue })
        .eq("id", veiculoId);

      if (error) {
        setMessage(error.message);
        return;
      }
      setEditingId(null);
      await loadData();
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Relatórios"
        description="Lista de todos os veículos cadastrados com placa, lote e último envio."
      />

      <div className="app-card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
          <input
            className="app-input pl-9"
            placeholder="Buscar por nome"
            value={searchNome}
            onChange={(e) => setSearchNome(e.target.value)}
          />
        </div>

        <input
          className="app-input"
          placeholder="Buscar por placa"
          value={searchPlaca}
          onChange={(e) => setSearchPlaca(e.target.value)}
        />

        <select className="app-input" value={filtroLoteId} onChange={(e) => setFiltroLoteId(e.target.value)}>
          <option value="">Todos os lotes</option>
          {lotes.map((lote) => (
            <option key={lote.id} value={lote.id}>{lote.nome}</option>
          ))}
        </select>

        <div>
          <span className="app-label">Envio de</span>
          <input type="date" className="app-input" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
        </div>

        <div>
          <span className="app-label">Envio até</span>
          <input type="date" className="app-input" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
        </div>
      </div>

      {message ? (
        <div className="app-card mb-4 border-app-green/40 p-3 text-sm text-app-white">{message}</div>
      ) : null}

      {loading ? (
        <div className="app-card flex items-center gap-2 p-6 text-sm text-app-muted">
          <Loader2 size={16} className="animate-spin" />
          Carregando relatório...
        </div>
      ) : filtrados.length === 0 ? (
        <div className="app-card p-6 text-sm text-app-muted">Nenhum veículo encontrado com os filtros atuais.</div>
      ) : (
        <div className="app-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-app-muted">Nome</th>
                  <th className="px-4 py-3 text-xs font-semibold text-app-muted">Placa</th>
                  <th className="px-4 py-3 text-xs font-semibold text-app-muted">Lote</th>
                  <th className="px-4 py-3 text-xs font-semibold text-app-muted">Último envio</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-app-muted">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((veiculo) => (
                  <tr key={veiculo.id} className="border-b border-app-border last:border-0 transition hover:bg-app-card/30">
                    <td className="px-4 py-3 font-medium text-app-white">{veiculo.nome_anuncio}</td>
                    <td className="px-4 py-3 text-app-muted">{veiculo.placa || "—"}</td>
                    <td className="px-4 py-3 text-app-muted">{veiculo.lote_nome ?? "—"}</td>
                    <td className="px-4 py-3 text-app-muted">
                      {editingId === veiculo.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="datetime-local"
                            className="app-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                          />
                          <button
                            className="app-button-secondary px-2 py-1 text-xs"
                            disabled={savingEdit}
                            onClick={() => void saveEdit(veiculo.id)}
                          >
                            {savingEdit ? <Loader2 size={14} className="animate-spin" /> : "Salvar"}
                          </button>
                          <button
                            className="text-xs text-app-muted hover:text-app-white"
                            disabled={savingEdit}
                            onClick={() => setEditingId(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          className="flex items-center gap-1.5 hover:text-app-white"
                          onClick={() => startEdit(veiculo)}
                          title="Editar data/hora do último envio"
                        >
                          {veiculo.ultimo_envio_em ? formatDateTime(veiculo.ultimo_envio_em) : "—"}
                          <Pencil size={12} />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          className="app-button-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
                          disabled={movingId === veiculo.id || lotes.length < 2}
                          onClick={() => void handleMoverProximoLote(veiculo)}
                          title={lotes.length < 2 ? "É necessário mais de um lote para mover" : "Mover para o próximo lote"}
                        >
                          {movingId === veiculo.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <SendHorizonal size={14} />
                          )}
                          Mover para o próximo lote
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function toLocalDateTimeInput(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
