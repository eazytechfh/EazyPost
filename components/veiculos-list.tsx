"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  CalendarClock, Check, CheckSquare, Edit3, ImagePlus, Layers, Loader2,
  MoreVertical, Search, Square, Trash2, Users, X, Zap
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { registrarLogComCliente } from "@/lib/audit-log";
import { venderVeiculoAction } from "@/app/actions/anuncio";
import { cleanCurrencyInput, formatCurrency, parseCurrencyInput } from "@/lib/format";
import type { AnuncioGrupo, IdDosGrupos, Lote, Veiculo } from "@/types/database";
import { RichTextEditor } from "./rich-text-editor";
import { SectionHeader } from "./section-header";

const LOTE_CAPACITY = 10;
const PAGE_SIZE = 12;
const NOME_LOTE_VENDIDOS = "Vendidos";

type EditState = Pick<Veiculo, "nome_anuncio" | "quilometragem" | "motor" | "cor" | "texto_anuncio" | "fipe" | "placa" | "tipo"> & {
  valor: string;
  pericia_aprova: boolean;
  pericia_motivo: string;
  leilao: boolean;
};

type LinkedGroupsByVehicle = Record<string, IdDosGrupos[]>;

type VehicleStatus = "pendente" | "ativo" | "inativo" | "vendido" | "devolvido" | "enviado";

const ALL_STATUSES: VehicleStatus[] = ["pendente", "ativo", "inativo", "vendido", "devolvido", "enviado"];

const STATUS_CONFIG: Record<VehicleStatus, { label: string; badge: string; dot: string; chip: string; activeChip: string }> = {
  pendente:  { label: "Pendente",  badge: "border-yellow-500 text-yellow-300",  dot: "bg-yellow-400",  chip: "border-app-border text-app-muted hover:border-yellow-500 hover:text-yellow-300",   activeChip: "border-yellow-500 text-yellow-300 bg-yellow-500/10" },
  ativo:     { label: "Ativo",     badge: "border-green-500 text-green-400",    dot: "bg-green-400",   chip: "border-app-border text-app-muted hover:border-green-500 hover:text-green-400",     activeChip: "border-green-500 text-green-400 bg-green-500/10" },
  inativo:   { label: "Inativo",   badge: "border-gray-500 text-gray-400",      dot: "bg-gray-400",    chip: "border-app-border text-app-muted hover:border-gray-500 hover:text-gray-400",       activeChip: "border-gray-500 text-gray-400 bg-gray-500/10" },
  vendido:   { label: "Vendido",   badge: "border-blue-500 text-blue-400",      dot: "bg-blue-400",    chip: "border-app-border text-app-muted hover:border-blue-500 hover:text-blue-400",       activeChip: "border-blue-500 text-blue-400 bg-blue-500/10" },
  devolvido: { label: "Devolvido", badge: "border-orange-500 text-orange-400",  dot: "bg-orange-400",  chip: "border-app-border text-app-muted hover:border-orange-500 hover:text-orange-400",   activeChip: "border-orange-500 text-orange-400 bg-orange-500/10" },
  enviado:   { label: "Enviado",   badge: "border-purple-500 text-purple-400",  dot: "bg-purple-400",  chip: "border-app-border text-app-muted hover:border-purple-500 hover:text-purple-400",   activeChip: "border-purple-500 text-purple-400 bg-purple-500/10" },
};

function extractFromTexto(texto: string, field: "pericia" | "leilao") {
  if (field === "leilao") {
    return texto.match(/^COM LEILÃO/m) ? "sim" : "nao";
  }
  return texto.match(/^PERÍCIA:\s*APROVA/m) ? "sim" : "nao";
}

function extractMotivo(texto: string): string {
  const m = texto.match(/^PERÍCIA:\s*NÃO APROVA[^-\n]*(?:\s*-\s*(.+))?$/m);
  return m?.[1]?.trim() ?? "";
}

function updateTextoLine(texto: string, field: "pericia" | "leilao", value: string, motivo?: string): string {
  if (field === "leilao") {
    const linha = value === "sim" ? "COM LEILÃO | SEM SINISTRO ✅" : "SEM LEILÃO | SEM SINISTRO ✅";
    return texto.replace(/^(COM|SEM) LEILÃO.*$/m, linha);
  }
  const pericia = value === "sim"
    ? "PERÍCIA: APROVA ✅"
    : `PERÍCIA: NÃO APROVA ❌${motivo ? ` - ${motivo}` : ""}`;
  return texto.replace(/^PERÍCIA:.*$/m, pericia);
}

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
  const [editNewFile, setEditNewFile] = useState<File | null>(null);
  const [editPreview, setEditPreview] = useState<string | null>(null);
  const [groupVehicle, setGroupVehicle] = useState<Veiculo | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [savingGroups, setSavingGroups] = useState(false);
  const [programModal, setProgramModal] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | null>(null);
  const [loteFilter, setLoteFilter] = useState<string | null>(null);
  const [movingVehicle, setMovingVehicle] = useState<Veiculo | null>(null);
  const [confirmDeleteVeiculo, setConfirmDeleteVeiculo] = useState<Veiculo | null>(null);
  const [deletingVeiculo, setDeletingVeiculo] = useState(false);
  const [creatingLote, setCreatingLote] = useState(false);
  const [newLoteName, setNewLoteName] = useState("");
  const [movingToLote, setMovingToLote] = useState(false);
  const [vehicleCountByLote, setVehicleCountByLote] = useState<Record<string, number>>({});
  const [totalVehicles, setTotalVehicles] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // --- seleção em massa ---
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkLoteModal, setBulkLoteModal] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const totalPages = Math.max(1, Math.ceil(totalVehicles / PAGE_SIZE));
  const hasActiveFilters = Boolean(searchTerm.trim() || statusFilter || loteFilter);
  const allPageSelected = veiculos.length > 0 && veiculos.every((v) => selectedIds.has(v.id));

  const loadData = useCallback(async () => {
    setLoading(true);
    const from = (currentPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = searchTerm.trim();

    let vehiclesQuery = supabase
      .from("veiculos")
      .select("*", { count: "exact" });

    if (term) {
      vehiclesQuery = vehiclesQuery.or(`nome_anuncio.ilike.%${term}%,placa.ilike.%${term}%`);
    }

    if (statusFilter) {
      vehiclesQuery = vehiclesQuery.eq("status", statusFilter);
    }

    if (loteFilter) {
      vehiclesQuery = vehiclesQuery.eq("lote_id", loteFilter);
    }

    vehiclesQuery = loteFilter
      ? vehiclesQuery.order("posicao_lote", { ascending: true }).range(from, to)
      : vehiclesQuery.order("created_at", { ascending: false }).range(from, to);

    const [veiculosResult, foundGroupsResult, linksResult, lotesResult] = await Promise.all([
      vehiclesQuery,
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
      setTotalVehicles(veiculosResult.count ?? 0);
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
      const loadedLotes = lotesResult.data ?? [];
      setLotes(loadedLotes);

      const countResults = await Promise.all(
        loadedLotes.map((lote) =>
          supabase
            .from("veiculos")
            .select("id", { count: "exact", head: true })
            .eq("lote_id", lote.id)
        )
      );
      const counts: Record<string, number> = {};
      loadedLotes.forEach((lote, index) => {
        counts[lote.id] = countResults[index].count ?? 0;
      });
      setVehicleCountByLote(counts);
    }

    setLoading(false);
  }, [currentPage, loteFilter, searchTerm, statusFilter, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [loteFilter, searchTerm, statusFilter]);

  useEffect(() => {
    const channel = supabase
      .channel("veiculos-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "veiculos" },
        () => { void loadData(); }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [loadData, supabase]);

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

  // -------------------------------------------------------------------------
  // Seleção em massa
  // -------------------------------------------------------------------------
  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllPage() {
    if (allPageSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(veiculos.map((v) => v.id)));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  async function bulkUpdateStatus(status: VehicleStatus) {
    setBulkProcessing(true);
    const ids = Array.from(selectedIds);

    const { error } = await supabase
      .from("veiculos")
      .update({ status, updated_at: new Date().toISOString() })
      .in("id", ids);

    if (error) {
      setMessage(error.message);
    } else {
      await registrarLogComCliente(
        supabase,
        `Usuario alterou o status de ${ids.length} veiculos para [${STATUS_CONFIG[status].label}] em massa`,
        "anuncio",
        ids.join(","),
        { status, quantidade: ids.length }
      );
      setBulkStatusOpen(false);
      clearSelection();
      await loadData();
    }
    setBulkProcessing(false);
  }

  async function bulkMoveToLote(targetLoteId: string) {
    setBulkProcessing(true);
    const ids = Array.from(selectedIds);

    const { error } = await supabase
      .from("veiculos")
      .update({ lote_id: targetLoteId, updated_at: new Date().toISOString() })
      .in("id", ids);

    if (error) {
      setMessage(error.message);
    } else {
      const lote = lotes.find((l) => l.id === targetLoteId);
      await registrarLogComCliente(
        supabase,
        `Usuario moveu ${ids.length} veiculos para o lote [${lote?.nome ?? targetLoteId}] em massa`,
        "veiculo",
        ids.join(","),
        { lote_destino: targetLoteId, quantidade: ids.length }
      );
      setBulkLoteModal(false);
      clearSelection();
      await loadData();
    }
    setBulkProcessing(false);
  }

  // -------------------------------------------------------------------------
  // Ações individuais
  // -------------------------------------------------------------------------
  function beginEdit(veiculo: Veiculo) {
    setEditing(veiculo);
    const texto = veiculo.texto_anuncio;
    setEditForm({
      nome_anuncio: veiculo.nome_anuncio,
      quilometragem: veiculo.quilometragem,
      motor: veiculo.motor,
      valor: String(Math.trunc(veiculo.valor)),
      cor: veiculo.cor,
      fipe: veiculo.fipe,
      placa: veiculo.placa,
      tipo: veiculo.tipo,
      texto_anuncio: texto,
      pericia_aprova: extractFromTexto(texto, "pericia") === "sim",
      pericia_motivo: extractMotivo(texto),
      leilao: extractFromTexto(texto, "leilao") === "sim"
    });
    setEditNewFile(null);
    setEditPreview(veiculo.imagens?.[0] ?? null);
    setOpenMenu(null);
  }

  function handleEditImage(file: File | null) {
    if (!file) return;
    setEditNewFile(file);
    setEditPreview(URL.createObjectURL(file));
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !editForm) return;

    const { data: { user } } = await supabase.auth.getUser();

    // Faz upload da nova imagem se o usuário trocou
    let novasImagens = editing.imagens ?? [];
    if (editNewFile && user) {
      const ext = editNewFile.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("veiculos-imagens")
        .upload(path, editNewFile, { cacheControl: "3600", upsert: false });

      if (uploadErr) { setMessage(uploadErr.message); return; }

      const { data: urlData } = supabase.storage.from("veiculos-imagens").getPublicUrl(path);
      // Substitui apenas a primeira imagem (thumbnail principal)
      novasImagens = [urlData.publicUrl, ...novasImagens.slice(1)];
    }

    const { error } = await supabase
      .from("veiculos")
      .update({
        nome_anuncio: editForm.nome_anuncio,
        quilometragem: editForm.quilometragem,
        motor: editForm.motor,
        cor: editForm.cor,
        texto_anuncio: editForm.texto_anuncio,
        fipe: editForm.fipe,
        placa: editForm.placa,
        tipo: editForm.tipo,
        valor: parseCurrencyInput(editForm.valor),
        imagens: novasImagens,
        updated_at: new Date().toISOString()
      })
      .eq("id", editing.id);

    if (error) { setMessage(error.message); return; }

    await registrarLogComCliente(
      supabase,
      `Usuario editou o anuncio [${editForm.nome_anuncio}]`,
      "anuncio",
      editing.id,
      { antes: { nome_anuncio: editing.nome_anuncio }, depois: editForm, imagem_trocada: Boolean(editNewFile) }
    );
    setEditing(null);
    setEditForm(null);
    setEditNewFile(null);
    setEditPreview(null);
    await loadData();
  }

  async function deleteVeiculo(id: string) {
    setDeletingVeiculo(true);
    const veiculo = veiculos.find((item) => item.id === id);
    const { error } = await supabase.from("veiculos").delete().eq("id", id);
    setDeletingVeiculo(false);
    setConfirmDeleteVeiculo(null);
    if (error) { setMessage(error.message); return; }
    await registrarLogComCliente(
      supabase,
      `Usuario excluiu o veiculo [${veiculo?.nome_anuncio ?? id}]`,
      "veiculo",
      id,
      { nome_anuncio: veiculo?.nome_anuncio, placa: veiculo?.placa }
    );
    setVeiculos((current) => current.filter((v) => v.id !== id));
    setOpenMenu(null);
  }

  async function updateVehicleStatus(id: string, status: VehicleStatus) {
    setOpenMenu(null);

    if (status === "vendido") {
      // Delegado ao server action: move para Lote Vendidos + preenche vaga
      setVeiculos((curr) => curr.map((v) => (v.id === id ? { ...v, status } : v)));
      const veiculo = veiculos.find((v) => v.id === id);

      const { error } = await venderVeiculoAction(id);
      if (error) {
        setMessage(error);
        await loadData();
        return;
      }

      await registrarLogComCliente(
        supabase,
        `Usuario marcou o anuncio [${veiculo?.nome_anuncio ?? id}] como Vendido e realocou a vaga do lote`,
        "anuncio",
        id,
        { status: "vendido", lote_anterior: veiculo?.lote_id }
      );

      // Dispara webhook de venda
      if (veiculo) {
        const { data: links } = await supabase
          .from("anuncio_grupos").select("grupo_id").eq("veiculo_id", id);
        const grupoDbIds = (links ?? []).map((l: { grupo_id: string }) => l.grupo_id);
        let grupos_ids: string[] = [];
        if (grupoDbIds.length > 0) {
          const { data: grupos } = await supabase
            .from("id_dos_grupos").select("id_do_grupo").in("id", grupoDbIds);
          grupos_ids = (grupos ?? [])
            .map((g: { id_do_grupo: string | null }) => g.id_do_grupo)
            .filter((v): v is string => Boolean(v));
        }
        fetch("https://n8n.eazy.tec.br/webhook/887a42e8-429f-423b-9b98-29d99da61015", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: veiculo.id, nome_anuncio: veiculo.nome_anuncio, placa: veiculo.placa,
            valor: veiculo.valor, fipe: veiculo.fipe, cor: veiculo.cor,
            motor: veiculo.motor, quilometragem: veiculo.quilometragem, tipo: veiculo.tipo,
            status: "vendido", imagens: veiculo.imagens, texto_anuncio: veiculo.texto_anuncio,
            grupos_ids
          })
        }).catch((err) => console.error("Erro ao disparar webhook de venda:", err));
      }

      await loadData();
      return;
    }

    // Demais status: atualização simples
    setVeiculos((curr) => curr.map((v) => (v.id === id ? { ...v, status } : v)));
    const { error } = await supabase
      .from("veiculos")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) { setMessage(error.message); await loadData(); return; }

    const veiculoAtualizado = veiculos.find((v) => v.id === id);
    await registrarLogComCliente(
      supabase,
      `Usuario atualizou o status do anuncio [${veiculoAtualizado?.nome_anuncio ?? id}] para [${STATUS_CONFIG[status].label}]`,
      "anuncio",
      id,
      { status }
    );
  }

  async function createLote(nome: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMessage("Sessao expirada. Faca login novamente."); return; }

    const { error } = await supabase.from("lotes").insert({ user_id: user.id, nome });
    if (error) { setMessage(error.message); return; }

    await registrarLogComCliente(supabase, `Usuario criou o lote [${nome}]`, "lote", nome, { nome });
    setNewLoteName("");
    setCreatingLote(false);
    await loadData();
  }

  async function selecionarLoteDaVez(loteId: string) {
    setLotes((curr) =>
      curr.map((l) => ({ ...l, lote_da_vez: l.id === loteId }))
    );

    const { error: clearError } = await supabase
      .from("lotes")
      .update({ lote_da_vez: false })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (clearError) { setMessage(clearError.message); await loadData(); return; }

    const { error } = await supabase
      .from("lotes")
      .update({ lote_da_vez: true })
      .eq("id", loteId);
    if (error) { setMessage(error.message); await loadData(); return; }

    const lote = lotes.find((item) => item.id === loteId);
    await registrarLogComCliente(
      supabase,
      `Usuario marcou o lote [${lote?.nome ?? loteId}] como proximo disparo`,
      "lote",
      loteId,
      { lote_da_vez: true }
    );
  }

  async function fetchLoteVehicles(loteId: string | null) {
    let query = supabase
      .from("veiculos")
      .select("*")
      .order("posicao_lote", { ascending: true });

    query = loteId ? query.eq("lote_id", loteId) : query.is("lote_id", null);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Veiculo[];
  }

  async function moveVehicleToLote(veiculo: Veiculo, targetLoteId: string | null) {
    setMovingToLote(true);
    setMessage("");

    try {
      type VehicleUpdate = { id: string; lote_id: string | null; posicao_lote: number };
      const updates: VehicleUpdate[] = [];

      if (!targetLoteId) {
        const oldLoteId = veiculo.lote_id;
        updates.push({ id: veiculo.id, lote_id: null, posicao_lote: 0 });

        if (oldLoteId) {
          const oldLoteVehicles = (await fetchLoteVehicles(oldLoteId))
            .filter((v) => v.lote_id === oldLoteId && v.id !== veiculo.id)
            .sort((a, b) => (a.posicao_lote ?? 0) - (b.posicao_lote ?? 0));
          oldLoteVehicles.forEach((v, idx) => {
            updates.push({ id: v.id, lote_id: oldLoteId, posicao_lote: idx + 1 });
          });
        }
      } else {
        let inTarget = (await fetchLoteVehicles(targetLoteId))
          .filter((v) => v.lote_id === targetLoteId && v.id !== veiculo.id)
          .sort((a, b) => (a.posicao_lote ?? 0) - (b.posicao_lote ?? 0));

        if (inTarget.length >= LOTE_CAPACITY) {
          const bumped = inTarget[inTarget.length - 1];
          inTarget = inTarget.slice(0, -1);

          const nextLote = lotes.find(
            (l) => l.id !== targetLoteId && (vehicleCountByLote[l.id] ?? 0) < LOTE_CAPACITY
          );

          if (!nextLote) {
            setMessage("Lote cheio e nenhum outro lote tem vagas. Crie um novo lote antes de mover.");
            return;
          }

          const inNext = (await fetchLoteVehicles(nextLote.id))
            .filter((v) => v.lote_id === nextLote.id && v.id !== bumped.id)
            .sort((a, b) => (a.posicao_lote ?? 0) - (b.posicao_lote ?? 0));

          const nextInsert = computeInsertIndex(bumped, inNext);
          const reorderedNext = insertAt(inNext, bumped, nextInsert);
          reorderedNext.forEach((v, idx) => {
            updates.push({ id: v.id, lote_id: nextLote.id, posicao_lote: idx + 1 });
          });
        }

        const insertIdx = computeInsertIndex(veiculo, inTarget);
        const reorderedTarget = insertAt(inTarget, veiculo, insertIdx);
        reorderedTarget.forEach((v, idx) => {
          updates.push({ id: v.id, lote_id: targetLoteId, posicao_lote: idx + 1 });
        });

        if (veiculo.lote_id && veiculo.lote_id !== targetLoteId) {
          const oldLoteVehicles = (await fetchLoteVehicles(veiculo.lote_id))
            .filter((v) => v.lote_id === veiculo.lote_id && v.id !== veiculo.id)
            .sort((a, b) => (a.posicao_lote ?? 0) - (b.posicao_lote ?? 0));
          oldLoteVehicles.forEach((v, idx) => {
            updates.push({ id: v.id, lote_id: veiculo.lote_id!, posicao_lote: idx + 1 });
          });
        }
      }

      const deduped = Array.from(new Map(updates.map((u) => [u.id, u])).values());

      const results = await Promise.all(
        deduped.map(({ id, lote_id, posicao_lote }) =>
          supabase.from("veiculos").update({ lote_id, posicao_lote, updated_at: new Date().toISOString() }).eq("id", id)
        )
      );

      const updateError = results.find((r) => r.error)?.error;
      if (updateError) { setMessage(updateError.message); return; }

      await registrarLogComCliente(
        supabase,
        `Usuario moveu o veiculo [${veiculo.nome_anuncio}] para ${targetLoteId ? "um lote" : "sem lote"}`,
        "veiculo",
        veiculo.id,
        { lote_anterior: veiculo.lote_id, lote_destino: targetLoteId, registros_atualizados: deduped.length }
      );
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

      await registrarLogComCliente(
        supabase,
        `Usuario atualizou os grupos do anuncio [${groupVehicle.nome_anuncio}]`,
        "anuncio_grupos",
        vehicleId,
        { adicionados: groupIdsToInsert, removidos: linksToDelete.map((link) => link.grupo_id) }
      );
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

    await registrarLogComCliente(
      supabase,
      `Usuario programou o anuncio [${veiculo.nome_anuncio}]`,
      "anuncio",
      veiculo.id,
      { grupos: linkedGroups.map((grupo) => grupo.id), programado_em: now }
    );
    await loadData();
  }

  const loteById = useMemo(() => new Map(lotes.map((l) => [l.id, l])), [lotes]);
  const hasGroups = availableGroups.length > 0;

  return (
    <section>
      <SectionHeader title="Lista de Veiculos" description="Gerencie anuncios, edicoes e programacoes por grupo." />

      {message ? <p className="mb-4 rounded-md border border-app-border bg-app-panel p-3 text-sm text-app-muted">{message}</p> : null}

      <div className="mb-4 space-y-3">
        {/* Search + botão de seleção */}
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
            <input
              className="app-input pl-9"
              placeholder="Buscar por nome ou 4 últimos da placa"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectionMode((v) => !v);
              if (selectionMode) setSelectedIds(new Set());
            }}
            className={`flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition ${
              selectionMode
                ? "border-app-green bg-app-green/10 text-app-green"
                : "border-app-border text-app-muted hover:border-app-green hover:text-app-green"
            }`}
          >
            {selectionMode ? <CheckSquare size={16} /> : <Square size={16} />}
            {selectionMode ? "Selecionando" : "Selecionar"}
          </button>
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
          {lotes.map((lote) => {
            const count = vehicleCountByLote[lote.id] ?? 0;
            const isActive = loteFilter === lote.id;
            const isVendidos = lote.nome === NOME_LOTE_VENDIDOS;
            const isFull = !isVendidos && count >= LOTE_CAPACITY;
            const isDaVez = lote.lote_da_vez === true;
            return (
              <div key={lote.id} className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setLoteFilter(isActive ? null : lote.id)}
                  className={`flex items-center gap-1.5 rounded-l-md rounded-r-none border px-3 py-1 text-xs font-semibold transition ${
                    isActive
                      ? "border-app-green text-app-green bg-app-green/10"
                      : "border-app-border text-app-muted hover:border-app-green hover:text-app-green"
                  }`}
                >
                  {isDaVez ? <Zap size={11} className="text-yellow-400" /> : <Layers size={11} />}
                  {lote.nome}
                  <span className={`ml-0.5 ${isFull ? "text-orange-400" : "text-app-muted"}`}>
                    {isVendidos ? count : `${count}/${LOTE_CAPACITY}`}
                  </span>
                </button>
                {!isVendidos && (
                  <button
                    type="button"
                    title="Marcar como próximo disparo"
                    onClick={() => void selecionarLoteDaVez(lote.id)}
                    className={`rounded-l-none rounded-r-md border border-l-0 p-1.5 transition ${
                      isDaVez
                        ? "border-yellow-500 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20"
                        : "border-app-border text-app-muted hover:border-yellow-500 hover:text-yellow-400"
                    }`}
                  >
                    <Zap size={10} />
                  </button>
                )}
                {isVendidos && (
                  <span className="rounded-l-none rounded-r-md border border-l-0 border-app-border px-1.5 py-1 text-xs text-app-muted">
                    ∞
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Barra de seleção em massa — aparece quando há itens selecionados */}
        {selectionMode && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-app-green/40 bg-app-green/5 px-4 py-3">
            {/* Selecionar todos da página */}
            <button
              type="button"
              onClick={toggleSelectAllPage}
              className="flex items-center gap-2 text-sm font-semibold text-app-white hover:text-app-green transition"
            >
              {allPageSelected
                ? <CheckSquare size={16} className="text-app-green" />
                : <Square size={16} className="text-app-muted" />}
              {allPageSelected ? "Desmarcar todos" : "Selecionar página"}
            </button>

            <span className="text-xs text-app-muted">|</span>

            <span className="text-sm font-bold text-app-green">
              {selectedIds.size} selecionado{selectedIds.size !== 1 ? "s" : ""}
            </span>

            {selectedIds.size > 0 && (
              <>
                <span className="text-xs text-app-muted">—</span>

                {/* Mudar status em massa */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setBulkStatusOpen((v) => !v)}
                    className="flex items-center gap-2 rounded-md border border-app-border bg-app-card px-3 py-1.5 text-sm font-semibold text-app-white hover:border-app-green hover:text-app-green transition"
                  >
                    <span className="h-2 w-2 rounded-full bg-app-muted" />
                    Mudar status
                  </button>
                  {bulkStatusOpen && (
                    <div className="absolute left-0 top-10 z-50 min-w-44 rounded-md border border-app-border bg-app-panel p-1 shadow-xl">
                      {ALL_STATUSES.map((s) => {
                        const cfg = STATUS_CONFIG[s];
                        return (
                          <button
                            key={s}
                            type="button"
                            disabled={bulkProcessing}
                            onClick={() => void bulkUpdateStatus(s)}
                            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition hover:bg-app-card ${cfg.badge.split(" ").find(c => c.startsWith("text-")) ?? "text-app-white"}`}
                          >
                            <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Mover para lote em massa */}
                <button
                  type="button"
                  onClick={() => setBulkLoteModal(true)}
                  className="flex items-center gap-2 rounded-md border border-app-border bg-app-card px-3 py-1.5 text-sm font-semibold text-app-white hover:border-app-green hover:text-app-green transition"
                >
                  <Layers size={14} />
                  Mover para lote
                </button>
              </>
            )}

            <button
              type="button"
              onClick={clearSelection}
              className="ml-auto flex items-center gap-1.5 text-xs text-app-muted hover:text-red-400 transition"
            >
              <X size={14} />
              Cancelar
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="app-card p-6 text-sm text-app-muted">Carregando veiculos...</div>
      ) : veiculos.length === 0 ? (
        <div className="app-card p-6 text-sm text-app-muted">
          {hasActiveFilters ? "Nenhum veiculo encontrado com os filtros aplicados." : "Nenhum veiculo cadastrado."}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {veiculos.map((veiculo) => (
              <VehicleCard
                key={veiculo.id}
                veiculo={veiculo}
                linkedGroups={linkedGroupsByVehicle[veiculo.id] ?? []}
                loteInfo={veiculo.lote_id ? { nome: loteById.get(veiculo.lote_id)?.nome ?? "Lote", posicao: veiculo.posicao_lote } : null}
                menuOpen={openMenu === veiculo.id}
                selectionMode={selectionMode}
                isSelected={selectedIds.has(veiculo.id)}
                onToggleSelect={() => toggleSelection(veiculo.id)}
                onToggleMenu={() => setOpenMenu(openMenu === veiculo.id ? null : veiculo.id)}
                onEdit={() => beginEdit(veiculo)}
                onDelete={() => { setConfirmDeleteVeiculo(veiculo); setOpenMenu(null); }}
                onGroups={() => { setGroupVehicle(veiculo); setOpenMenu(null); }}
                onProgram={() => { void programVehicle(veiculo); }}
                onStatusChange={(status) => void updateVehicleStatus(veiculo.id, status)}
                onMoverLote={() => { setMovingVehicle(veiculo); setOpenMenu(null); }}
              />
            ))}
          </div>

          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalVehicles}
            onPageChange={setCurrentPage}
          />
        </>
      )}

      {editing && editForm ? (
        <Modal title="Editar Anuncio" onClose={() => { setEditing(null); setEditNewFile(null); setEditPreview(null); }}>
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
              <EditInput label="FIPE" value={editForm.fipe} onChange={(value) => setEditForm({ ...editForm, fipe: value })} />
              <EditInput label="Cor" value={editForm.cor} onChange={(value) => setEditForm({ ...editForm, cor: value })} />
              <EditInput label="Placa" value={editForm.placa} onChange={(value) => setEditForm({ ...editForm, placa: value.toUpperCase() })} />
              <label className="space-y-2">
                <span className="app-label">Tipo</span>
                <select className="app-input" value={editForm.tipo} onChange={(e) => setEditForm({ ...editForm, tipo: e.target.value })} required>
                  <option value="aleatorio">ALEATÓRIO</option>
                  <option value="prioridade">PRIORIDADE</option>
                </select>
              </label>
            </div>
            <div className="space-y-2">
              <span className="app-label">Perícia Aprova?</span>
              <div className="flex gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-app-white">
                  <input
                    type="radio"
                    name="edit_pericia"
                    className="accent-app-green h-4 w-4"
                    checked={editForm.pericia_aprova === true}
                    onChange={() => {
                      const texto = updateTextoLine(editForm.texto_anuncio, "pericia", "sim");
                      setEditForm({ ...editForm, pericia_aprova: true, pericia_motivo: "", texto_anuncio: texto });
                    }}
                  />
                  SIM
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-app-white">
                  <input
                    type="radio"
                    name="edit_pericia"
                    className="accent-app-green h-4 w-4"
                    checked={editForm.pericia_aprova === false}
                    onChange={() => {
                      const texto = updateTextoLine(editForm.texto_anuncio, "pericia", "nao", editForm.pericia_motivo);
                      setEditForm({ ...editForm, pericia_aprova: false, texto_anuncio: texto });
                    }}
                  />
                  NÃO
                </label>
              </div>
              {editForm.pericia_aprova === false && (
                <input
                  className="app-input mt-2"
                  value={editForm.pericia_motivo}
                  placeholder="Informe o motivo"
                  onChange={(e) => {
                    const motivo = e.target.value;
                    const texto = updateTextoLine(editForm.texto_anuncio, "pericia", "nao", motivo);
                    setEditForm({ ...editForm, pericia_motivo: motivo, texto_anuncio: texto });
                  }}
                />
              )}
            </div>
            <div className="space-y-2">
              <span className="app-label">Leilão?</span>
              <div className="flex gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-app-white">
                  <input
                    type="radio"
                    name="edit_leilao"
                    className="accent-app-green h-4 w-4"
                    checked={editForm.leilao === false}
                    onChange={() => {
                      const texto = updateTextoLine(editForm.texto_anuncio, "leilao", "nao");
                      setEditForm({ ...editForm, leilao: false, texto_anuncio: texto });
                    }}
                  />
                  NÃO (padrão)
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-app-white">
                  <input
                    type="radio"
                    name="edit_leilao"
                    className="accent-app-green h-4 w-4"
                    checked={editForm.leilao === true}
                    onChange={() => {
                      const texto = updateTextoLine(editForm.texto_anuncio, "leilao", "sim");
                      setEditForm({ ...editForm, leilao: true, texto_anuncio: texto });
                    }}
                  />
                  SIM
                </label>
              </div>
            </div>
            <RichTextEditor value={editForm.texto_anuncio} onChange={(value) => setEditForm({ ...editForm, texto_anuncio: value })} />

            {/* Imagem */}
            <div className="space-y-2">
              <span className="app-label">Imagem</span>
              {editPreview ? (
                <div className="relative aspect-video w-full overflow-hidden rounded-md border border-app-border">
                  <Image src={editPreview} alt="Preview" fill unoptimized className="object-cover" />
                  {editNewFile ? (
                    <span className="absolute left-2 top-2 rounded-md border border-app-green bg-app-black/80 px-2 py-0.5 text-xs font-bold text-app-green">
                      Nova imagem
                    </span>
                  ) : null}
                </div>
              ) : null}
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-app-border bg-app-panel px-4 py-3 text-sm font-semibold text-app-muted transition hover:border-app-green hover:text-app-white">
                <ImagePlus size={16} className="text-app-green" />
                {editPreview ? "Trocar imagem" : "Adicionar imagem"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleEditImage(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

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

      {confirmDeleteVeiculo ? (
        <Modal title="Excluir veículo" onClose={() => setConfirmDeleteVeiculo(null)}>
          <p className="text-sm leading-6 text-app-muted">
            Tem certeza que deseja excluir o veículo{" "}
            <span className="font-semibold text-app-white">{confirmDeleteVeiculo.nome_anuncio}</span>
            {" "}(placa {confirmDeleteVeiculo.placa})? Essa ação não pode ser desfeita.
          </p>
          <div className="mt-5 flex gap-3">
            <button
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition"
              disabled={deletingVeiculo}
              onClick={() => void deleteVeiculo(confirmDeleteVeiculo.id)}
            >
              {deletingVeiculo ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Excluir
            </button>
            <button
              className="flex-1 rounded-md border border-app-border bg-app-card py-2 text-sm font-semibold text-app-white hover:border-app-green transition"
              onClick={() => setConfirmDeleteVeiculo(null)}
            >
              Cancelar
            </button>
          </div>
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

      {/* Modal de mover em massa para lote */}
      {bulkLoteModal ? (
        <BulkMoverLoteModal
          lotes={lotes}
          vehicleCountByLote={vehicleCountByLote}
          quantidade={selectedIds.size}
          saving={bulkProcessing}
          onMove={(loteId) => void bulkMoveToLote(loteId)}
          onClose={() => setBulkLoteModal(false)}
        />
      ) : null}

      {/* Overlay de loading para ações em massa */}
      {bulkProcessing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-app-black/60">
          <div className="flex items-center gap-3 rounded-lg border border-app-border bg-app-panel px-6 py-4">
            <Loader2 size={20} className="animate-spin text-app-green" />
            <span className="text-sm font-semibold text-app-white">Aplicando ação em massa...</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Modal: mover em massa para lote
// ---------------------------------------------------------------------------
function BulkMoverLoteModal({
  lotes,
  vehicleCountByLote,
  quantidade,
  saving,
  onMove,
  onClose
}: {
  lotes: Lote[];
  vehicleCountByLote: Record<string, number>;
  quantidade: number;
  saving: boolean;
  onMove: (loteId: string) => void;
  onClose: () => void;
}) {
  const lotesDisponiveis = lotes.filter((l) => l.nome !== NOME_LOTE_VENDIDOS);
  const [selected, setSelected] = useState<string>(lotesDisponiveis[0]?.id ?? "");

  return (
    <Modal title="Mover para Lote (em massa)" onClose={onClose}>
      <p className="mb-4 text-sm text-app-muted">
        Mover <span className="font-bold text-app-white">{quantidade} veículo{quantidade !== 1 ? "s" : ""}</span> para o lote selecionado.
      </p>

      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {lotesDisponiveis.map((lote) => {
          const count = vehicleCountByLote[lote.id] ?? 0;
          const isFull = count >= LOTE_CAPACITY;
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
                name="bulk-lote"
                className="accent-app-green"
                checked={selected === lote.id}
                onChange={() => setSelected(lote.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-semibold text-app-white text-sm">
                    {lote.lote_da_vez ? <Zap size={11} className="text-yellow-400 shrink-0" /> : null}
                    {lote.nome}
                  </span>
                  <span className={`text-xs font-bold ${isFull ? "text-orange-400" : "text-app-muted"}`}>
                    {count}/{LOTE_CAPACITY}
                  </span>
                </span>
                <div className="mt-1.5 h-1.5 rounded-full bg-app-border overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${isFull ? "bg-orange-400" : "bg-app-green"}`}
                    style={{ width: `${Math.min(progress * 100, 100)}%` }}
                  />
                </div>
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className="app-button flex-1"
          disabled={saving || !selected}
          onClick={() => onMove(selected)}
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

// ---------------------------------------------------------------------------
// Modal: mover veículo individual para lote
// ---------------------------------------------------------------------------
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
  const lotesDisponiveis = lotes.filter((l) => l.nome !== NOME_LOTE_VENDIDOS);
  const [selected, setSelected] = useState<string>(veiculo.lote_id ?? lotesDisponiveis[0]?.id ?? "");

  const currentLoteId = veiculo.lote_id;
  const targetLoteId = selected || null;

  const willBump = useMemo(() => {
    if (!targetLoteId) return null;
    const count = vehicleCountByLote[targetLoteId] ?? 0;
    if (count < LOTE_CAPACITY) return null;

    const next = lotesDisponiveis.find((l) => l.id !== targetLoteId && (vehicleCountByLote[l.id] ?? 0) < LOTE_CAPACITY);
    if (!next) return { bumped: true, nextLote: null as Lote | null };
    return { bumped: true, nextLote: next };
  }, [targetLoteId, vehicleCountByLote, lotesDisponiveis]);

  return (
    <Modal title="Mover para Lote" onClose={onClose}>
      <p className="mb-4 text-sm text-app-muted truncate">{veiculo.nome_anuncio}</p>

      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {lotesDisponiveis.map((lote) => {
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
                  <span className="flex items-center gap-1.5 font-semibold text-app-white text-sm">
                    {lote.lote_da_vez ? <Zap size={11} className="text-yellow-400 shrink-0" /> : null}
                    {lote.nome}
                  </span>
                  <span className={`text-xs font-bold ${isFull ? "text-orange-400" : "text-app-muted"}`}>
                    {count}/{LOTE_CAPACITY}
                  </span>
                </span>
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

function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  onPageChange
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return (
      <p className="mt-4 text-sm text-app-muted">
        {totalItems} veiculo{totalItems !== 1 ? "s" : ""} encontrado{totalItems !== 1 ? "s" : ""}.
      </p>
    );
  }

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-md border border-app-border bg-app-panel p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-app-muted">
        Pagina {currentPage} de {totalPages} - {totalItems} veiculo{totalItems !== 1 ? "s" : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-app-border px-3 py-2 text-sm font-semibold text-app-muted transition hover:border-app-green hover:text-app-green disabled:cursor-not-allowed disabled:opacity-40"
          disabled={currentPage === 1}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        >
          Anterior
        </button>
        {pages.map((page) => (
          <button
            key={page}
            type="button"
            className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
              page === currentPage
                ? "border-app-green bg-app-green/10 text-app-green"
                : "border-app-border text-app-muted hover:border-app-green hover:text-app-green"
            }`}
            onClick={() => onPageChange(page)}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          className="rounded-md border border-app-border px-3 py-2 text-sm font-semibold text-app-muted transition hover:border-app-green hover:text-app-green disabled:cursor-not-allowed disabled:opacity-40"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        >
          Proxima
        </button>
      </div>
    </div>
  );
}

function VehicleCard({
  veiculo,
  linkedGroups,
  loteInfo,
  menuOpen,
  selectionMode,
  isSelected,
  onToggleSelect,
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
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
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
    <article
      className={`group app-card relative overflow-visible transition ${
        isSelected
          ? "border-app-green ring-2 ring-app-green/30"
          : "hover:border-app-green"
      }`}
      onClick={selectionMode ? onToggleSelect : undefined}
      style={selectionMode ? { cursor: "pointer" } : undefined}
    >
      {/* Checkbox de seleção */}
      {selectionMode && (
        <div className="absolute left-3 top-3 z-10">
          <div className={`flex h-5 w-5 items-center justify-center rounded border-2 transition ${
            isSelected ? "border-app-green bg-app-green" : "border-white/70 bg-app-black/50"
          }`}>
            {isSelected && <Check size={12} className="text-app-black font-bold" />}
          </div>
        </div>
      )}

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
          {!selectionMode && (
            <div className="relative shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); onToggleMenu(); setShowStatusSubmenu(false); }}
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
          )}
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-app-black/80 px-4 py-6">
      <div className="flex w-full max-w-xl flex-col max-h-[90vh] rounded-lg border border-app-border bg-app-panel">
        {/* Cabeçalho fixo */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-app-border px-5 py-4">
          <h2 className="text-lg font-bold text-app-white">{title}</h2>
          <button onClick={onClose} className="rounded-md border border-app-border bg-app-card p-2 text-app-white hover:border-app-green">
            <X size={18} />
          </button>
        </div>
        {/* Conteúdo rolável */}
        <div className="overflow-y-auto p-5">
          {children}
        </div>
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
