"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { CalendarClock, Check, Edit3, Layers, Loader2, MoreVertical, PackagePlus, Search, Trash2, Users, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { cleanCurrencyInput, formatCurrency, parseCurrencyInput } from "@/lib/format";
import type { AnuncioGrupo, IdDosGrupos, Lote, Veiculo } from "@/types/database";
import { RichTextEditor } from "./rich-text-editor";
import { SectionHeader } from "./section-header";

const LOTE_CAPACITY = 16;

type EditState = Pick<Veiculo, "nome_anuncio" | "quilometragem" | "motor" | "cor" | "texto_anuncio"> & {
  valor: string;
};

type LinkedGroupsByVehicle = Record<string, IdDosGrupos[]>;

type VehicleStatus = "pendente" | "ativo" | "inativo" | "vendido" | "devolvido";

const ALL_STATUSES: VehicleStatus[] = ["pendente", "ativo", "inativo", "vendido", "devolvido"];

const STATUS_CONFIG: Record<VehicleStatus, { label: string; badge: string; dot: string; chip: string; activeChip: string }> = {
  pendente:  { label: "Pendente",  badge: "border-yellow-500 text-yellow-300",  dot: "bg-yellow-400",  chip: "border-app-border text-app-muted hover:border-yellow-500 hover:text-yellow-300",   activeChip: "border-yellow-500 text-yellow-300 bg-yellow-500/10" },
  ativo:     { label: "Ativo",     badge: "border-green-500 text-green-400",    dot: "bg-green-400",   chip: "border-app-border text-app-muted hover:border-green-500 hover:text-green-400",     activeChip: "border-green-500 text-green-400 bg-green-500/10" },
  inativo:   { label: "Inativo",   badge: "border-gray-500 text-gray-400",      dot: "bg-gray-400",    chip: "border-app-border text-app-muted hover:border-gray-500 hover:text-gray-400",       activeChip: "border-gray-500 text-gray-400 bg-gray-500/10" },
  vendido:   { label: "Vendido",   badge: "border-blue-500 text-blue-400",      dot: "bg-blue-400",    chip: "border-app-border text-app-muted hover:border-blue-500 hover:text-blue-400",       activeChip: "border-blue-500 text-blue-400 bg-blue-500/10" },
  devolvido: { label: "Devolvido", badge: "border-orange-500 text-orange-400",  dot: "bg-orange-400",  chip: "border-app-border text-app-muted hover:border-orange-500 hover:text-orange-400",   activeChip: "border-orange-500 text-orange-400 bg-orange-500/10" },
};

function computeInsertIndex(veiculo: Veiculo, sorted: Veiculo[]): number {
  if (veiculo.tipo === "prioridade") {
    const firstAleatorio = sorted.findIndex((v) => v.tipo !== "prioridade");
    return firstAleatorio === -1 ? sorted.length : firstAleatorio;
  }
  return sorted.length;
}

function insertAt<T>(arr: T[], item: T, index: number): T[] {
  return [...arr.slice(0, index), item, ...arr.slice(index)];
}

export function VeiculosList() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [availableGroups, setAvailableGroups] = useState<IdDosGrupos[]>([]);
  const [linkedGroupsByVehicle, setLinkedGroupsByVehicle] = useState<LinkedGroupsByVehicle>({});
  const [currentVehicleLinks, setCurrentVehicleLinks] = useState<AnuncioGrupo[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<Veiculo | null>(null);
  const [editForm, setEditForm] = useState<EditState | null>(null);
  const [groupVehicle, setGroupVehicle] = useState<Veiculo | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [savingGroups, setSavingGroups] = useState(false);
  const [programModal, setProgramModal] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | null>(null);
  const [loteFilter, setLoteFilter] = useState<string | null>(null);
  const [movingVehicle, setMovingVehicle] = useState<Veiculo | null>(null);
  const [creatingLote, setCreatingLote] = useState(false);
  const [newLoteName, setNewLoteName] = useState("");
  const [movingToLote, setMovingToLote] = useState(false);

  const vehicleCountByLote = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of veiculos) {
      if (v.lote_id) {
        counts[v.lote_id] = (counts[v.lote_id] ?? 0) + 1;
      }
    }
    return counts;
  }, [veiculos]);

  const filteredVeiculos = useMemo(() => {
    let list = veiculos;
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      list = list.filter((v) =>
        v.nome_anuncio.toLowerCase().includes(term) ||
        (v.placa ?? "").slice(-4).toLowerCase().includes(term)
      );
    }
    if (statusFilter) {
      list = list.filter((v) => v.status.trim().toLowerCase() === statusFilter);
    }
    if (loteFilter === "sem-lote") {
      list = list.filter((v) => !v.lote_id);
    } else if (loteFilter) {
      list = list.filter((v) => v.lote_id === loteFilter);
      list = [...list].sort((a, b) => (a.posicao_lote ?? 0) - (b.posicao_lote ?? 0));
    }
    return list;
  }, [veiculos, searchTerm, statusFilter, loteFilter]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [veiculosResult, foundGroupsResult, linksResult, lotesResult] = await Promise.all([
      supabase.from("veiculos").select("*").order("created_at", { ascending: false }),
      supabase
        .from("id_dos_grupos")
        .select("*")
        .ilike("status", "Encontrado")
        .order("nome_do_grupo", { ascending: true }),
      supabase.from("anuncio_grupos").select("*"),
      supabase.from("lotes").select("*").order("created_at", { ascending: true })
    ]);

    if (veiculosResult.error) {
      setMessage(veiculosResult.error.message);
    } else {
      setVeiculos(veiculosResult.data ?? []);
    }

    if (foundGroupsResult.error) {
      setMessage(foundGroupsResult.error.message);
    } else {
      setAvailableGroups(foundGroupsResult.data ?? []);
    }

    if (linksResult.error) {
      setMessage(linksResult.error.message);
    } else {
      setLinkedGroupsByVehicle(buildLinkedGroupsMap(linksResult.data ?? [], foundGroupsResult.data ?? []));
    }

    if (lotesResult.error) {
      setMessage(lotesResult.error.message);
    } else {
      setLotes(lotesResult.data ?? []);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const channel = supabase
      .channel("veiculos-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "veiculos" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newVehicle = payload.new as Veiculo;
            setVeiculos((current) => [newVehicle, ...current.filter((v) => v.id !== newVehicle.id)]);
            return;
          }
          if (payload.eventType === "UPDATE") {
            const updatedVehicle = payload.new as Veiculo;
            setVeiculos((current) =>
              current.map((v) => (v.id === updatedVehicle.id ? updatedVehicle : v))
            );
            return;
          }
          if (payload.eventType === "DELETE") {
            const deletedVehicle = payload.old as Pick<Veiculo, "id">;
            setVeiculos((current) => current.filter((v) => v.id !== deletedVehicle.id));
          }
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [supabase]);

  useEffect(() => {
    const channel = supabase
      .channel("lotes-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lotes" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setLotes((curr) => [...curr, payload.new as Lote]);
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as Lote;
            setLotes((curr) => curr.map((l) => (l.id === updated.id ? updated : l)));
          } else if (payload.eventType === "DELETE") {
            const deleted = payload.old as Pick<Lote, "id">;
            setLotes((curr) => curr.filter((l) => l.id !== deleted.id));
          }
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [supabase]);

  useEffect(() => {
    if (!groupVehicle) {
      setCurrentVehicleLinks([]);
      setSelectedGroupIds([]);
      return;
    }

    const vehicleId = groupVehicle.id;

    async function loadVehicleGroups() {
      const [foundGroupsResult, linksResult] = await Promise.all([
        supabase
          .from("id_dos_grupos")
          .select("*")
          .ilike("status", "Encontrado")
          .order("nome_do_grupo", { ascending: true }),
        supabase
          .from("anuncio_grupos")
          .select("*")
          .eq("veiculo_id", vehicleId)
      ]);

      if (foundGroupsResult.error || linksResult.error) {
        setMessage(foundGroupsResult.error?.message ?? linksResult.error?.message ?? "Nao foi possivel carregar os grupos.");
        setAvailableGroups([]);
        setCurrentVehicleLinks([]);
        setSelectedGroupIds([]);
        return;
      }

      const links = linksResult.data ?? [];
      setAvailableGroups(foundGroupsResult.data ?? []);
      setCurrentVehicleLinks(links);
      setSelectedGroupIds(links.map((link) => link.grupo_id));
    }

    void loadVehicleGroups();
  }, [groupVehicle, supabase]);

  function beginEdit(veiculo: Veiculo) {
    setEditing(veiculo);
    setEditForm({
      nome_anuncio: veiculo.nome_anuncio,
      quilometragem: veiculo.quilometragem,
      motor: veiculo.motor,
      valor: String(Math.trunc(veiculo.valor)),
      cor: veiculo.cor,
      texto_anuncio: veiculo.texto_anuncio
    });
    setOpenMenu(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !editForm) return;

    const { error } = await supabase
      .from("veiculos")
      .update({ ...editForm, valor: parseCurrencyInput(editForm.valor), updated_at: new Date().toISOString() })
      .eq("id", editing.id);

    if (error) { setMessage(error.message); return; }
    setEditing(null);
    setEditForm(null);
    await loadData();
  }

  async function deleteVeiculo(id: string) {
    const { error } = await supabase.from("veiculos").delete().eq("id", id);
    if (error) { setMessage(error.message); return; }
    setVeiculos((current) => current.filter((v) => v.id !== id));
    setOpenMenu(null);
  }

  async function updateVehicleStatus(id: string, status: VehicleStatus) {
    setOpenMenu(null);
    const { error } = await supabase
      .from("veiculos")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) { setMessage(error.message); return; }

    if (status === "vendido") {
      const veiculo = veiculos.find((v) => v.id === id);
      if (veiculo) {
        fetch("https://eazytech-n8n.gsl3ku.easypanel.host/webhook/73b454b0-7617-406c-9781-e8ba77550d2d", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: veiculo.id,
            nome_anuncio: veiculo.nome_anuncio,
            placa: veiculo.placa,
            valor: veiculo.valor,
            fipe: veiculo.fipe,
            cor: veiculo.cor,
            motor: veiculo.motor,
            quilometragem: veiculo.quilometragem,
            ano: veiculo.ano,
            tipo: veiculo.tipo,
            status: "vendido",
            imagens: veiculo.imagens,
            texto_anuncio: veiculo.texto_anuncio
          })
        }).catch((err) => console.error("Erro ao disparar webhook de venda:", err));
      }
    }
  }

  async function createLote(nome: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMessage("Sessao expirada. Faca login novamente."); return; }

    const { error } = await supabase.from("lotes").insert({ user_id: user.id, nome });
    if (error) { setMessage(error.message); return; }

    setNewLoteName("");
    setCreatingLote(false);
  }

  async function moveVehicleToLote(veiculo: Veiculo, targetLoteId: string | null) {
    setMovingToLote(true);
    setMessage("");

    try {
      type VehicleUpdate = { id: string; lote_id: string | null; posicao_lote: number };
      const updates: VehicleUpdate[] = [];

      // Unassign from lote
      if (!targetLoteId) {
        const oldLoteId = veiculo.lote_id;
        updates.push({ id: veiculo.id, lote_id: null, posicao_lote: 0 });

        // Renumber old lote
        if (oldLoteId) {
          const oldLoteVehicles = veiculos
            .filter((v) => v.lote_id === oldLoteId && v.id !== veiculo.id)
            .sort((a, b) => (a.posicao_lote ?? 0) - (b.posicao_lote ?? 0));
          oldLoteVehicles.forEach((v, idx) => {
            updates.push({ id: v.id, lote_id: oldLoteId, posicao_lote: idx + 1 });
          });
        }
      } else {
        // Vehicles currently in target lote, excluding the moving vehicle
        let inTarget = veiculos
          .filter((v) => v.lote_id === targetLoteId && v.id !== veiculo.id)
          .sort((a, b) => (a.posicao_lote ?? 0) - (b.posicao_lote ?? 0));

        // If full, bump last vehicle to next available lote
        if (inTarget.length >= LOTE_CAPACITY) {
          const bumped = inTarget[inTarget.length - 1];
          inTarget = inTarget.slice(0, -1);

          // Find next available lote (excluding target)
          const nextLote = lotes.find(
            (l) => l.id !== targetLoteId && (vehicleCountByLote[l.id] ?? 0) < LOTE_CAPACITY
          );

          if (!nextLote) {
            setMessage("Lote cheio e nenhum outro lote tem vagas. Crie um novo lote antes de mover.");
            return;
          }

          // Place bumped in next lote
          const inNext = veiculos
            .filter((v) => v.lote_id === nextLote.id && v.id !== bumped.id)
            .sort((a, b) => (a.posicao_lote ?? 0) - (b.posicao_lote ?? 0));

          const nextInsert = computeInsertIndex(bumped, inNext);
          const reorderedNext = insertAt(inNext, bumped, nextInsert);
          reorderedNext.forEach((v, idx) => {
            updates.push({ id: v.id, lote_id: nextLote.id, posicao_lote: idx + 1 });
          });
        }

        // Insert moving vehicle at correct position in target
        const insertIdx = computeInsertIndex(veiculo, inTarget);
        const reorderedTarget = insertAt(inTarget, veiculo, insertIdx);
        reorderedTarget.forEach((v, idx) => {
          updates.push({ id: v.id, lote_id: targetLoteId, posicao_lote: idx + 1 });
        });

        // Renumber old lote if vehicle was in a different lote
        if (veiculo.lote_id && veiculo.lote_id !== targetLoteId) {
          const oldLoteVehicles = veiculos
            .filter((v) => v.lote_id === veiculo.lote_id && v.id !== veiculo.id)
            .sort((a, b) => (a.posicao_lote ?? 0) - (b.posicao_lote ?? 0));
          oldLoteVehicles.forEach((v, idx) => {
            updates.push({ id: v.id, lote_id: veiculo.lote_id!, posicao_lote: idx + 1 });
          });
        }
      }

      // Deduplicate: keep last update per vehicle id
      const deduped = Array.from(new Map(updates.map((u) => [u.id, u])).values());

      const results = await Promise.all(
        deduped.map(({ id, lote_id, posicao_lote }) =>
          supabase.from("veiculos").update({ lote_id, posicao_lote, updated_at: new Date().toISOString() }).eq("id", id)
        )
      );

      const updateError = results.find((r) => r.error)?.error;
      if (updateError) { setMessage(updateError.message); return; }

      setMovingVehicle(null);
      await loadData();
    } finally {
      setMovingToLote(false);
    }
  }

  function toggleSelectedGroup(groupId: string) {
    setSelectedGroupIds((current) =>
      current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]
    );
  }

  async function saveLinkedGroups() {
    if (!groupVehicle) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMessage("Sessao expirada. Faca login novamente."); return; }

    setSavingGroups(true);
    setMessage("");

    const vehicleId = groupVehicle.id;
    const selectedSet = new Set(selectedGroupIds);
    const currentSet = new Set(currentVehicleLinks.map((link) => link.grupo_id));
    const linksToDelete = currentVehicleLinks.filter((link) => !selectedSet.has(link.grupo_id));
    const groupIdsToInsert = selectedGroupIds.filter((groupId) => !currentSet.has(groupId));

    try {
      const deleteResults = await Promise.all(
        linksToDelete.map((link) => supabase.from("anuncio_grupos").delete().eq("id", link.id))
      );
      const deleteError = deleteResults.find((result) => result.error)?.error;
      if (deleteError) throw deleteError;

      if (groupIdsToInsert.length > 0) {
        const { error } = await supabase.from("anuncio_grupos").insert(
          groupIdsToInsert.map((groupId) => ({
            veiculo_id: vehicleId,
            grupo_id: groupId,
            user_id: user.id
          }))
        );
        if (error) throw error;
      }

      setGroupVehicle(null);
      setCurrentVehicleLinks([]);
      setSelectedGroupIds([]);
      setMessage("Grupos do anuncio atualizados.");
      await loadData();
    } catch (error) {
      setMessage(getErrorMessage(error, "Nao foi possivel atualizar os grupos do anuncio."));
    } finally {
      setSavingGroups(false);
    }
  }

  async function programVehicle(veiculo: Veiculo) {
    setOpenMenu(null);
    setMessage("");

    const now = new Date().toISOString();
    const [{ error: vehicleError }, { error: linksError }] = await Promise.all([
      supabase.from("veiculos").update({ status: "ativo", updated_at: now }).eq("id", veiculo.id),
      supabase.from("anuncio_grupos").update({ programado: true, programado_em: now }).eq("veiculo_id", veiculo.id)
    ]);

    if (vehicleError || linksError) {
      setMessage(vehicleError?.message ?? linksError?.message ?? "Nao foi possivel programar o anuncio.");
      return;
    }

    const linkedGroups = linkedGroupsByVehicle[veiculo.id] ?? [];
    const groupNames = linkedGroups.map((grupo) => grupo.nome).join(", ");

    if (groupNames) {
      setProgramModal(`Anuncio programado! Em breve ele sera iniciado, acompanhe no grupo: ${groupNames}.`);
    } else {
      setProgramModal("Anuncio programado! Vincule um grupo para acompanhar a divulgacao.");
    }

    await loadData();
  }

  const loteById = useMemo(() => new Map(lotes.map((l) => [l.id, l])), [lotes]);
  const hasGroups = availableGroups.length > 0;

  return (
    <section>
      <SectionHeader title="Lista de Veiculos" description="Gerencie anuncios, edicoes e programacoes por grupo." />

      {message ? <p className="mb-4 rounded-md border border-app-border bg-app-panel p-3 text-sm text-app-muted">{message}</p> : null}

      <div className="mb-4 space-y-3">
        {/* Search */}
        <div className="relative max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
          <input
            className="app-input pl-9"
            placeholder="Buscar por nome ou 4 últimos da placa"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter(null)}
            className={`rounded-md border px-3 py-1 text-xs font-semibold transition ${
              statusFilter === null
                ? "border-app-green text-app-green bg-app-green/10"
                : "border-app-border text-app-muted hover:border-app-green hover:text-app-green"
            }`}
          >
            Todos
          </button>
          {ALL_STATUSES.map((s) => {
            const cfg = STATUS_CONFIG[s];
            const isActive = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(isActive ? null : s)}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-semibold transition ${
                  isActive ? cfg.activeChip : cfg.chip
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Lote filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-app-muted">Lotes:</span>
          <button
            type="button"
            onClick={() => setLoteFilter(null)}
            className={`rounded-md border px-3 py-1 text-xs font-semibold transition ${
              loteFilter === null
                ? "border-app-green text-app-green bg-app-green/10"
                : "border-app-border text-app-muted hover:border-app-green hover:text-app-green"
            }`}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => setLoteFilter(loteFilter === "sem-lote" ? null : "sem-lote")}
            className={`rounded-md border px-3 py-1 text-xs font-semibold transition ${
              loteFilter === "sem-lote"
                ? "border-app-green text-app-green bg-app-green/10"
                : "border-app-border text-app-muted hover:border-app-green hover:text-app-green"
            }`}
          >
            Sem Lote
          </button>
          {lotes.map((lote) => {
            const count = vehicleCountByLote[lote.id] ?? 0;
            const isActive = loteFilter === lote.id;
            const isFull = count >= LOTE_CAPACITY;
            return (
              <button
                key={lote.id}
                type="button"
                onClick={() => setLoteFilter(isActive ? null : lote.id)}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-semibold transition ${
                  isActive
                    ? "border-app-green text-app-green bg-app-green/10"
                    : "border-app-border text-app-muted hover:border-app-green hover:text-app-green"
                }`}
              >
                <Layers size={11} />
                {lote.nome}
                <span className={`ml-0.5 ${isFull ? "text-orange-400" : "text-app-muted"}`}>
                  {count}/{LOTE_CAPACITY}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCreatingLote(true)}
            className="flex items-center gap-1.5 rounded-md border border-dashed border-app-border px-3 py-1 text-xs font-semibold text-app-muted transition hover:border-app-green hover:text-app-green"
          >
            <PackagePlus size={12} />
            Novo Lote
          </button>
        </div>
      </div>

      {loading ? (
        <div className="app-card p-6 text-sm text-app-muted">Carregando veiculos...</div>
      ) : filteredVeiculos.length === 0 ? (
        <div className="app-card p-6 text-sm text-app-muted">
          {veiculos.length === 0 ? "Nenhum veiculo cadastrado." : "Nenhum veiculo encontrado com os filtros aplicados."}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredVeiculos.map((veiculo) => (
            <VehicleCard
              key={veiculo.id}
              veiculo={veiculo}
              linkedGroups={linkedGroupsByVehicle[veiculo.id] ?? []}
              loteInfo={veiculo.lote_id ? { nome: loteById.get(veiculo.lote_id)?.nome ?? "Lote", posicao: veiculo.posicao_lote } : null}
              menuOpen={openMenu === veiculo.id}
              onToggleMenu={() => setOpenMenu(openMenu === veiculo.id ? null : veiculo.id)}
              onEdit={() => beginEdit(veiculo)}
              onDelete={() => deleteVeiculo(veiculo.id)}
              onGroups={() => { setGroupVehicle(veiculo); setOpenMenu(null); }}
              onProgram={() => { void programVehicle(veiculo); }}
              onStatusChange={(status) => void updateVehicleStatus(veiculo.id, status)}
              onMoverLote={() => { setMovingVehicle(veiculo); setOpenMenu(null); }}
            />
          ))}
        </div>
      )}

      {editing && editForm ? (
        <Modal title="Editar Anuncio" onClose={() => setEditing(null)}>
          <form onSubmit={saveEdit} className="space-y-4">
            <EditInput label="Nome" value={editForm.nome_anuncio} onChange={(value) => setEditForm({ ...editForm, nome_anuncio: value })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <EditInput label="KM" value={editForm.quilometragem} onChange={(value) => setEditForm({ ...editForm, quilometragem: value })} />
              <EditInput label="Motor" value={editForm.motor} onChange={(value) => setEditForm({ ...editForm, motor: value })} />
              <EditInput
                label="Valor"
                value={editForm.valor}
                inputMode="numeric"
                onChange={(value) => setEditForm({ ...editForm, valor: cleanCurrencyInput(value) })}
              />
              <EditInput label="Cor" value={editForm.cor} onChange={(value) => setEditForm({ ...editForm, cor: value })} />
            </div>
            <RichTextEditor value={editForm.texto_anuncio} onChange={(value) => setEditForm({ ...editForm, texto_anuncio: value })} />
            <button className="app-button">
              <Check size={18} />
              Salvar
            </button>
          </form>
        </Modal>
      ) : null}

      {groupVehicle ? (
        <Modal title="Grupos de Anuncio" onClose={() => setGroupVehicle(null)}>
          {hasGroups ? (
            <div className="space-y-4">
              <p className="text-sm text-app-muted">{groupVehicle.nome_anuncio}</p>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {availableGroups.map((grupo) => (
                  <label
                    key={grupo.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-app-border bg-app-card p-3 transition hover:border-app-green"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-app-green"
                      checked={selectedGroupIds.includes(grupo.id)}
                      onChange={() => toggleSelectedGroup(grupo.id)}
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-app-white">{grupo.nome_do_grupo}</span>
                      <span className="mt-1 block break-all text-xs text-app-muted">{grupo.id_do_grupo ?? "-"}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button type="button" className="app-button" onClick={saveLinkedGroups} disabled={savingGroups}>
                  {savingGroups ? <Loader2 className="animate-spin" size={18} /> : <Users size={18} />}
                  Salvar Grupos
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-app-muted">Cadastre um grupo antes de vincular anuncios.</p>
          )}
        </Modal>
      ) : null}

      {programModal ? (
        <Modal title="Programacao criada" onClose={() => setProgramModal(null)}>
          <p className="text-sm leading-6 text-app-muted">{programModal}</p>
          <button className="app-button mt-5" onClick={() => setProgramModal(null)}>Fechar</button>
        </Modal>
      ) : null}

      {movingVehicle ? (
        <MoverLoteModal
          veiculo={movingVehicle}
          lotes={lotes}
          vehicleCountByLote={vehicleCountByLote}
          saving={movingToLote}
          onMove={(targetLoteId) => void moveVehicleToLote(movingVehicle, targetLoteId)}
          onClose={() => setMovingVehicle(null)}
        />
      ) : null}

      {creatingLote ? (
        <Modal title="Novo Lote" onClose={() => { setCreatingLote(false); setNewLoteName(""); }}>
          <form
            onSubmit={(e) => { e.preventDefault(); void createLote(newLoteName); }}
            className="space-y-4"
          >
            <label className="space-y-2 block">
              <span className="app-label">Nome do Lote</span>
              <input
                className="app-input"
                value={newLoteName}
                onChange={(e) => setNewLoteName(e.target.value)}
                placeholder="Ex: Lote 1"
                required
                autoFocus
              />
            </label>
            <button className="app-button" type="submit">
              <PackagePlus size={18} />
              Criar Lote
            </button>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

function MoverLoteModal({
  veiculo,
  lotes,
  vehicleCountByLote,
  saving,
  onMove,
  onClose
}: {
  veiculo: Veiculo;
  lotes: Lote[];
  vehicleCountByLote: Record<string, number>;
  saving: boolean;
  onMove: (targetLoteId: string | null) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | "sem-lote">(veiculo.lote_id ?? "sem-lote");

  const currentLoteId = veiculo.lote_id;
  const targetLoteId = selected === "sem-lote" ? null : selected;

  const willBump = useMemo(() => {
    if (!targetLoteId) return null;
    const count = vehicleCountByLote[targetLoteId] ?? 0;
    // If the vehicle is already in this lote, the effective count is one less
    const effectiveCount = currentLoteId === targetLoteId ? count : count;
    if (effectiveCount < LOTE_CAPACITY) return null;

    // Find next available lote
    const next = lotes.find((l) => l.id !== targetLoteId && (vehicleCountByLote[l.id] ?? 0) < LOTE_CAPACITY);
    if (!next) return { bumped: true, nextLote: null as Lote | null };
    return { bumped: true, nextLote: next };
  }, [targetLoteId, vehicleCountByLote, lotes, currentLoteId]);

  return (
    <Modal title="Mover para Lote" onClose={onClose}>
      <p className="mb-4 text-sm text-app-muted truncate">{veiculo.nome_anuncio}</p>

      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {/* Sem Lote option */}
        <label className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition ${
          selected === "sem-lote" ? "border-app-green bg-app-green/5" : "border-app-border bg-app-card hover:border-app-green"
        }`}>
          <input
            type="radio"
            name="lote"
            className="accent-app-green"
            checked={selected === "sem-lote"}
            onChange={() => setSelected("sem-lote")}
          />
          <span className="flex-1 text-sm font-semibold text-app-white">Sem Lote</span>
          {!currentLoteId ? <span className="text-xs text-app-muted">atual</span> : null}
        </label>

        {lotes.map((lote) => {
          const count = vehicleCountByLote[lote.id] ?? 0;
          const isFull = count >= LOTE_CAPACITY;
          const isCurrent = lote.id === currentLoteId;
          const progress = count / LOTE_CAPACITY;

          return (
            <label
              key={lote.id}
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition ${
                selected === lote.id ? "border-app-green bg-app-green/5" : "border-app-border bg-app-card hover:border-app-green"
              }`}
            >
              <input
                type="radio"
                name="lote"
                className="accent-app-green"
                checked={selected === lote.id}
                onChange={() => setSelected(lote.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-app-white text-sm">{lote.nome}</span>
                  <span className={`text-xs font-bold ${isFull ? "text-orange-400" : "text-app-muted"}`}>
                    {count}/{LOTE_CAPACITY}
                  </span>
                </span>
                {/* Capacity bar */}
                <div className="mt-1.5 h-1.5 rounded-full bg-app-border overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${isFull ? "bg-orange-400" : "bg-app-green"}`}
                    style={{ width: `${Math.min(progress * 100, 100)}%` }}
                  />
                </div>
              </span>
              {isCurrent ? <span className="shrink-0 text-xs text-app-muted">atual</span> : null}
            </label>
          );
        })}
      </div>

      {willBump ? (
        <div className="mt-3 rounded-md border border-orange-500/40 bg-orange-500/10 p-3 text-xs text-orange-300">
          {willBump.nextLote
            ? `Este lote está cheio. O último veículo será movido automaticamente para "${willBump.nextLote.nome}".`
            : "Este lote está cheio e não há outro lote com vagas. Crie um novo lote primeiro."}
        </div>
      ) : null}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className="app-button flex-1"
          disabled={saving || (willBump?.nextLote === null && willBump?.bumped === true)}
          onClick={() => onMove(targetLoteId)}
        >
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Layers size={18} />}
          Confirmar
        </button>
        <button type="button" className="app-button-secondary" onClick={onClose} disabled={saving}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}

function VehicleCard({
  veiculo,
  linkedGroups,
  loteInfo,
  menuOpen,
  onToggleMenu,
  onEdit,
  onDelete,
  onGroups,
  onProgram,
  onStatusChange,
  onMoverLote
}: {
  veiculo: Veiculo;
  linkedGroups: IdDosGrupos[];
  loteInfo: { nome: string; posicao: number } | null;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onGroups: () => void;
  onProgram: () => void;
  onStatusChange: (status: VehicleStatus) => void;
  onMoverLote: () => void;
}) {
  const thumbnail = useMemo(() => veiculo.imagens?.[0], [veiculo.imagens]);
  const [showStatusSubmenu, setShowStatusSubmenu] = useState(false);

  return (
    <article className="group app-card relative overflow-visible transition hover:border-app-green">
      <div className="relative aspect-video overflow-hidden rounded-t-lg bg-app-panel">
        {thumbnail ? (
          <Image src={thumbnail} alt={veiculo.nome_anuncio} fill className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-app-muted">Sem imagem</div>
        )}
        <StatusBadge status={veiculo.status} />
        {loteInfo ? (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md border border-app-green/40 bg-app-black/70 px-2 py-0.5 text-xs font-bold text-app-green backdrop-blur-sm">
            <Layers size={10} />
            {loteInfo.nome} · #{loteInfo.posicao}
          </span>
        ) : null}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-app-white">{veiculo.nome_anuncio}</h2>
            <LinkedGroups groups={linkedGroups} />
            <p className="mt-1 text-lg font-bold text-app-green">{formatCurrency(veiculo.valor)}</p>
          </div>
          <div className="relative shrink-0">
            <button
              onClick={() => { onToggleMenu(); setShowStatusSubmenu(false); }}
              className="rounded-md border border-app-border bg-app-panel p-2 text-app-white transition hover:border-app-green"
              aria-label="Acoes"
            >
              <MoreVertical size={18} />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-11 z-50 min-w-56 max-w-[calc(100vw-2rem)] rounded-md border border-app-border bg-app-panel p-1 shadow-xl">
                <ActionButton icon={<Edit3 size={16} />} label="Editar" onClick={onEdit} />
                <ActionButton icon={<Trash2 size={16} />} label="Excluir" onClick={onDelete} />
                <ActionButton icon={<Users size={16} />} label="Grupos de Anuncio" onClick={onGroups} />
                <ActionButton icon={<CalendarClock size={16} />} label="Programar" onClick={onProgram} />
                <ActionButton icon={<Layers size={16} />} label="Mover para Lote" onClick={onMoverLote} />

                <div className="my-1 border-t border-app-border" />

                <button
                  onClick={() => setShowStatusSubmenu((v) => !v)}
                  className="flex w-full items-center justify-between whitespace-nowrap rounded-md px-3 py-2 text-left text-sm text-app-white transition hover:bg-app-card hover:text-app-green"
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${STATUS_CONFIG[veiculo.status.trim().toLowerCase() as VehicleStatus]?.dot ?? "bg-yellow-400"}`} />
                    Mudar Status
                  </span>
                  <span className="text-app-muted">{showStatusSubmenu ? "▲" : "▼"}</span>
                </button>

                {showStatusSubmenu ? (
                  <div className="mt-1 space-y-0.5 rounded-md border border-app-border bg-app-card p-1">
                    {ALL_STATUSES.map((s) => {
                      const cfg = STATUS_CONFIG[s];
                      const isCurrent = veiculo.status.trim().toLowerCase() === s;
                      return (
                        <button
                          key={s}
                          onClick={() => { onStatusChange(s); setShowStatusSubmenu(false); }}
                          disabled={isCurrent}
                          className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition ${
                            isCurrent ? "cursor-default opacity-40" : "hover:bg-app-panel"
                          } ${cfg.badge.split(" ").find(c => c.startsWith("text-")) ?? "text-app-white"}`}
                        >
                          <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                          {isCurrent ? <span className="ml-auto text-xs opacity-60">atual</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <Info label="KM" value={veiculo.quilometragem} />
          <Info label="Motor" value={veiculo.motor} />
          <Info label="Cor" value={veiculo.cor} />
        </dl>
        {veiculo.placa ? (
          <p className="mt-2 text-xs text-app-muted">
            Placa: <span className="font-semibold text-app-white">{veiculo.placa}</span>
          </p>
        ) : null}
      </div>
    </article>
  );
}

function buildLinkedGroupsMap(links: AnuncioGrupo[], groupIds: IdDosGrupos[]) {
  const groupsById = new Map(groupIds.map((grupo) => [grupo.id, grupo]));
  const linkedGroupsByVehicle: LinkedGroupsByVehicle = {};

  for (const link of links) {
    const grupo = groupsById.get(link.grupo_id);
    if (!grupo) continue;
    const currentGroups = linkedGroupsByVehicle[link.veiculo_id] ?? [];
    const alreadyLinked = currentGroups.some((item) => item.id === grupo.id);
    if (!alreadyLinked) {
      linkedGroupsByVehicle[link.veiculo_id] = [...currentGroups, grupo];
    }
  }

  return linkedGroupsByVehicle;
}

function StatusBadge({ status }: { status: string }) {
  const key = status.trim().toLowerCase() as VehicleStatus;
  const cfg = STATUS_CONFIG[key] ?? STATUS_CONFIG.pendente;
  return (
    <span className={`absolute left-3 top-3 rounded-md border bg-app-panel px-2 py-1 text-xs font-bold ${cfg.badge}`}>
      {cfg.label}
    </span>
  );
}

function LinkedGroups({ groups }: { groups: IdDosGrupos[] }) {
  if (groups.length === 0) {
    return <p className="mt-1 text-xs text-app-muted">Nenhum grupo vinculado</p>;
  }
  return <p className="mt-1 truncate text-xs font-semibold text-app-green">{groups.map((g) => g.nome_do_grupo).join(", ")}</p>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-app-border bg-app-panel p-2">
      <dt className="text-xs text-app-muted">{label}</dt>
      <dd className="truncate text-sm font-semibold text-app-white">{value}</dd>
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm text-app-white transition hover:bg-app-card hover:text-app-green"
    >
      {icon}
      {label}
    </button>
  );
}

function EditInput({
  label,
  value,
  inputMode,
  onChange
}: {
  label: string;
  value: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2">
      <span className="app-label">{label}</span>
      <input className="app-input" value={value} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} required />
    </label>
  );
}

function Modal({
  title,
  children,
  onClose
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-app-black/80 px-4">
      <div className="w-full max-w-xl rounded-lg border border-app-border bg-app-panel p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-app-white">{title}</h2>
          <button onClick={onClose} className="rounded-md border border-app-border bg-app-card p-2 text-app-white hover:border-app-green">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}
