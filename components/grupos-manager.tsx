"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, Trash2, X } from "lucide-react";
import { registrarLogComCliente } from "@/lib/audit-log";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { IdDosGrupos } from "@/types/database";
import { SectionHeader } from "./section-header";

const groupIdWebhookUrl = "https://n8n.eazy.tec.br/webhook/e326e099-ba8a-4db7-9a10-52b10910ecc5";

type GroupIdResult = {
  nome_do_grupo: string;
  id_do_grupo: string | null;
  status: "buscando" | "ativo" | "nao encontrado";
};

export function GruposManager() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [savedGroupIds, setSavedGroupIds] = useState<IdDosGrupos[]>([]);
  const [groupIdField, setGroupIdField] = useState("");
  const [groupIdResults, setGroupIdResults] = useState<GroupIdResult[]>([]);
  const [searchingGroupIds, setSearchingGroupIds] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshCountdown, setRefreshCountdown] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadSavedGroupIds = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setMessage(userError?.message ?? "Sessao expirada. Faca login novamente.");
      setSavedGroupIds([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("id_dos_grupos")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
    } else {
      setSavedGroupIds(data ?? []);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadSavedGroupIds();
  }, [loadSavedGroupIds]);

  useEffect(() => {
    let isActive = true;

    async function subscribeToSavedGroupIds() {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user || !isActive) {
        return;
      }

      const channel = supabase
        .channel("id_dos_grupos")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "id_dos_grupos"
          },
          (payload) => {
            if (payload.eventType === "INSERT") {
              const newRow = payload.new as IdDosGrupos;
              setSavedGroupIds((current) => [newRow, ...current.filter((group) => group.id !== newRow.id)]);
              return;
            }

            if (payload.eventType === "UPDATE") {
              const updatedRow = payload.new as IdDosGrupos;
              setSavedGroupIds((current) =>
                current
                  .map((group) => (group.id === updatedRow.id ? updatedRow : group))
                  .sort((first, second) => getCreatedAtTime(second.created_at) - getCreatedAtTime(first.created_at))
              );
              return;
            }

            if (payload.eventType === "DELETE") {
              const deletedRow = payload.old as Pick<IdDosGrupos, "id">;
              setSavedGroupIds((current) => current.filter((group) => group.id !== deletedRow.id));
            }
          }
        )
        .subscribe();

      return channel;
    }

    let subscribedChannel: ReturnType<typeof supabase.channel> | null = null;

    void subscribeToSavedGroupIds().then((channel) => {
      if (!channel) {
        return;
      }

      if (isActive) {
        subscribedChannel = channel;
      } else {
        void supabase.removeChannel(channel);
      }
    });

    return () => {
      isActive = false;

      if (subscribedChannel) {
        void supabase.removeChannel(subscribedChannel);
      }
    };
  }, [supabase]);

  useEffect(() => {
    if (refreshCountdown === null) return;
    if (refreshCountdown === 0) {
      window.location.reload();
      return;
    }
    const timer = setTimeout(() => setRefreshCountdown((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(timer);
  }, [refreshCountdown]);

  async function searchGroupIds() {
    const groupNames = groupIdField.trim().length > 0 ? [groupIdField] : [];

    if (groupNames.length === 0) {
      setMessage("Informe pelo menos um nome de grupo para procurar.");
      return;
    }

    setSearchingGroupIds(true);
    setMessage("");
    setRefreshCountdown(5);
    setGroupIdResults(
      groupNames.map((name) => ({
        nome_do_grupo: name,
        id_do_grupo: null,
        status: "buscando"
      }))
    );

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage("Sessao expirada. Faca login novamente.");
      setGroupIdResults([]);
      setSearchingGroupIds(false);
      return;
    }

    try {
      const response = await fetch(groupIdWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          grupos: groupNames,
          user_id: user.id
        })
      });

      if (!response.ok) {
        throw new Error("Nao foi possivel procurar os IDs dos grupos.");
      }

      const payload = (await response.json()) as unknown;
      const results = normalizeGroupIdResults(payload, groupNames);

      setGroupIdResults(results);
      setMessage("Busca de IDs concluida.");
      await registrarLogComCliente(
        supabase,
        `Usuario solicitou cadastro/busca do grupo [${groupNames.join(", ")}]`,
        "grupo",
        groupNames.join(", "),
        { grupos: groupNames, resultados: results }
      );
    } catch (error) {
      setGroupIdResults(
        groupNames.map((name) => ({
          nome_do_grupo: name,
          id_do_grupo: null,
          status: "nao encontrado"
        }))
      );
      setMessage(error instanceof Error ? error.message : "Nao foi possivel procurar os IDs dos grupos.");
    } finally {
      setSearchingGroupIds(false);
    }
  }

  async function deleteSavedGroupId(id: string) {
    setDeletingId(id);
    const grupo = savedGroupIds.find((item) => item.id === id);
    const { error } = await supabase.from("id_dos_grupos").delete().eq("id", id);
    setDeletingId(null);
    setConfirmDeleteId(null);

    if (error) {
      setMessage(error.message);
      return;
    }

    await registrarLogComCliente(
      supabase,
      `Usuario excluiu o grupo [${grupo?.nome_do_grupo ?? id}]`,
      "grupo",
      id,
      { nome_do_grupo: grupo?.nome_do_grupo, id_do_grupo: grupo?.id_do_grupo }
    );
    setSavedGroupIds((current) => current.filter((group) => group.id !== id));
  }

  return (
    <section>
      <SectionHeader title="Grupos" description="Cadastre os grupos do WhatsApp usados na divulgacao dos veiculos." />

      <div className="app-card mb-6 p-5">
        <div className="mb-4">
          <div>
            <h2 className="font-bold text-app-white">Buscar ID dos Grupos</h2>
            <p className="mt-1 text-sm text-app-muted">Digite os nomes dos grupos do WhatsApp para localizar os IDs.</p>
          </div>
        </div>

        <div className="mb-4 rounded-md border border-[#f59e0b]/50 bg-[#451a03] p-3 text-sm leading-6 text-[#fef3c7]">
          <span className="mr-2" aria-hidden="true">
            ⚠️
          </span>
          Atenção: Digite o nome EXATO do grupo como aparece no WhatsApp, incluindo letras maiúsculas, minúsculas, espaços e emojis. Qualquer diferença impedirá a localização do grupo.
        </div>

        <input
          className="app-input"
          value={groupIdField}
          onChange={(event) => setGroupIdField(event.target.value)}
          placeholder="Nome do grupo do WhatsApp"
        />

        <button type="button" className="app-button mt-4" onClick={searchGroupIds} disabled={searchingGroupIds || refreshCountdown !== null}>
          {searchingGroupIds ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
          Procurar ID
        </button>

        {refreshCountdown !== null ? (
          <p className="mt-3 text-sm text-app-muted">
            Atualizando a página em <span className="font-bold text-app-green">{refreshCountdown}s</span>...
          </p>
        ) : null}

        {groupIdResults.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-md border border-app-border">
            <div className="hidden grid-cols-[1.4fr_1.2fr_auto] gap-3 border-b border-app-border bg-app-panel px-3 py-2 text-xs font-bold uppercase text-app-muted sm:grid">
              <span>Nome do grupo</span>
              <span>ID retornado</span>
              <span>Status</span>
            </div>
            <div className="divide-y divide-app-border">
              {groupIdResults.map((result, index) => {
                const statusDisplay = getGroupIdStatusDisplay(result.status);

                return (
                  <div key={`${result.nome_do_grupo}-${result.id_do_grupo ?? "empty"}-${index}`} className="grid gap-2 px-3 py-3 text-sm sm:grid-cols-[1.4fr_1.2fr_auto] sm:items-center">
                    <span className="font-semibold text-app-white">{result.nome_do_grupo}</span>
                    <span className="break-all text-app-muted">{result.id_do_grupo ?? "-"}</span>
                    <span className={`w-fit rounded-md border px-2 py-1 text-xs font-bold ${statusDisplay.className}`}>
                      {statusDisplay.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {message ? <p className="mb-4 rounded-md border border-app-border bg-app-panel p-3 text-sm text-app-muted">{message}</p> : null}

      {loading ? (
        <div className="app-card p-6 text-sm text-app-muted">Carregando grupos...</div>
      ) : savedGroupIds.length === 0 ? (
        <div className="app-card p-6 text-sm text-app-muted">Nenhum grupo cadastrado.</div>
      ) : (
        <div className="app-card overflow-hidden">
          <div className="hidden grid-cols-[1.2fr_1.3fr_auto_1fr_auto] gap-3 border-b border-app-border bg-app-panel px-4 py-3 text-xs font-bold uppercase text-app-muted lg:grid">
            <span>Nome do Grupo</span>
            <span>ID do Grupo</span>
            <span>Status</span>
            <span>Data de Cadastro</span>
            <span className="text-right">Acoes</span>
          </div>
          <div className="divide-y divide-app-border">
            {savedGroupIds.map((group) => {
              const statusDisplay = getSavedGroupStatusDisplay(group.status);

              return (
                <article key={group.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.2fr_1.3fr_auto_1fr_auto] lg:items-center">
                  <div>
                    <span className="block text-xs font-bold uppercase text-app-muted lg:hidden">Nome do Grupo</span>
                    <span className="font-semibold text-app-white">{group.nome_do_grupo}</span>
                  </div>
                  <div>
                    <span className="block text-xs font-bold uppercase text-app-muted lg:hidden">ID do Grupo</span>
                    <span className="break-all text-app-muted">{group.id_do_grupo ?? "-"}</span>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-bold uppercase text-app-muted lg:hidden">Status</span>
                    <span className={`w-fit rounded-md border px-2 py-1 text-xs font-bold ${statusDisplay.className}`}>
                      {statusDisplay.label}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs font-bold uppercase text-app-muted lg:hidden">Data de Cadastro</span>
                    <span className="text-app-muted">{formatDateTime(group.created_at)}</span>
                  </div>
                  {confirmDeleteId === group.id ? (
                    <div className="flex items-center gap-2 lg:justify-self-end">
                      <span className="text-xs text-app-muted">Confirmar?</span>
                      <button
                        type="button"
                        onClick={() => void deleteSavedGroupId(group.id)}
                        disabled={deletingId === group.id}
                        className="rounded-md border border-red-500/40 bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20"
                        aria-label={`Confirmar exclusão de ${group.nome_do_grupo}`}
                      >
                        {deletingId === group.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-md border border-app-border p-1.5 text-app-muted hover:border-app-green hover:text-app-white"
                        aria-label="Cancelar"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(group.id)}
                      className="w-fit rounded-md border border-app-border bg-app-card p-2.5 text-app-white transition hover:border-red-500 hover:text-red-400 lg:justify-self-end"
                      aria-label={`Excluir ${group.nome_do_grupo}`}
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function normalizeGroupIdResults(payload: unknown, requestedNames: string[]): GroupIdResult[] {
  const rawItems = extractGroupIdItems(payload);

  if (rawItems.length === 0) {
    return requestedNames.map((name) => ({
      nome_do_grupo: name,
      id_do_grupo: null,
      status: "nao encontrado"
    }));
  }

  return requestedNames.map((name, index) => {
    const item = findGroupIdItem(rawItems, name, index);
    const id = getStringValue(item, ["id_do_grupo", "id_grupo", "group_id", "grupo_id", "id", "jid"]);
    const status = getStringValue(item, ["status"]);
    const found = Boolean(id) && !status.toLowerCase().includes("nao") && !status.toLowerCase().includes("não");

    return {
      nome_do_grupo: name,
      id_do_grupo: id || null,
      status: found ? "ativo" : "nao encontrado"
    };
  });
}

function getGroupIdStatusDisplay(status: GroupIdResult["status"]) {
  if (status === "buscando") {
    return {
      label: "Buscando...",
      className: "border-yellow-500 bg-yellow-500/10 text-yellow-300"
    };
  }

  if (status === "ativo") {
    return {
      label: "Encontrado",
      className: "border-app-green bg-app-panel text-app-green"
    };
  }

  return {
    label: "Não encontrado",
    className: "border-red-500 bg-app-panel text-red-400"
  };
}

function getSavedGroupStatusDisplay(status: string) {
  const normalizedStatus = status.trim().toLowerCase();

  if (normalizedStatus === "ativo" || normalizedStatus === "encontrado") {
    return {
      label: status,
      className: "border-app-green bg-app-panel text-app-green"
    };
  }

  if (normalizedStatus === "pendente") {
    return {
      label: status,
      className: "border-yellow-500 bg-yellow-500/10 text-yellow-300"
    };
  }

  return {
    label: status || "-",
    className: "border-app-border bg-app-panel text-app-muted"
  };
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getCreatedAtTime(value: string) {
  const time = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function extractGroupIdItems(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeGroupIdItem(item));
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["resultados", "results", "data", "grupos"]) {
    const value = payload[key];

    if (Array.isArray(value)) {
      return value.map((item) => normalizeGroupIdItem(item));
    }
  }

  return Object.entries(payload).map(([name, value]) => {
    if (isRecord(value)) {
      return { nome_do_grupo: name, ...value };
    }

    return { nome_do_grupo: name, id_do_grupo: value };
  });
}

function findGroupIdItem(items: Record<string, unknown>[], name: string, index: number) {
  const normalizedName = normalizeText(name);
  const itemByName = items.find((item) => {
    const itemName = getStringValue(item, ["nome_do_grupo", "nome", "grupo", "name"]);

    return normalizeText(itemName) === normalizedName;
  });

  return itemByName ?? items[index] ?? {};
}

function normalizeGroupIdItem(item: unknown) {
  if (isRecord(item)) {
    return item;
  }

  return { id_do_grupo: item };
}

function getStringValue(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];

    if (value !== undefined && value !== null) {
      return String(value).trim();
    }
  }

  return "";
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
