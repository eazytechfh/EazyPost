"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { Grupo } from "@/types/database";
import { SectionHeader } from "./section-header";

const groupIdWebhookUrl = "https://n8n.eazy.tec.br/webhook/e326e099-ba8a-4db7-9a10-52b10910ecc5";

type GroupIdResult = {
  nome_do_grupo: string;
  id_do_grupo: string | null;
  status: "ativo" | "não encontrado";
};

export function GruposManager() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [groupIdFields, setGroupIdFields] = useState([""]);
  const [groupIdResults, setGroupIdResults] = useState<GroupIdResult[]>([]);
  const [searchingGroupIds, setSearchingGroupIds] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const loadGrupos = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("grupos").select("*").order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
    } else {
      setGrupos(data ?? []);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadGrupos();
  }, [loadGrupos]);

  function updateGroupIdField(index: number, value: string) {
    setGroupIdFields((current) => current.map((field, fieldIndex) => (fieldIndex === index ? value : field)));
  }

  function addGroupIdField() {
    setGroupIdFields((current) => [...current, ""]);
  }

  function removeGroupIdField(index: number) {
    setGroupIdFields((current) => (current.length === 1 ? current : current.filter((_, fieldIndex) => fieldIndex !== index)));
  }

  async function searchGroupIds() {
    const groupNames = groupIdFields.map((field) => field.trim()).filter(Boolean);

    if (groupNames.length === 0) {
      setMessage("Informe pelo menos um nome de grupo para procurar.");
      return;
    }

    setSearchingGroupIds(true);
    setMessage("");

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage("Sessao expirada. Faca login novamente.");
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

      const { error } = await supabase.from("id_dos_grupos").insert(
        results.map((result) => ({
          user_id: user.id,
          nome_do_grupo: result.nome_do_grupo,
          id_do_grupo: result.id_do_grupo ?? "",
          status: result.status
        }))
      );

      if (error) {
        throw error;
      }

      setGroupIdResults(results);
      setMessage("Busca de IDs concluida.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nao foi possivel procurar os IDs dos grupos.");
    } finally {
      setSearchingGroupIds(false);
    }
  }

  async function deleteGrupo(id: string) {
    const { error } = await supabase.from("grupos").delete().eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setGrupos((current) => current.filter((grupo) => grupo.id !== id));
  }

  return (
    <section>
      <SectionHeader title="Grupos" description="Cadastre os grupos do WhatsApp usados na divulgacao dos veiculos." />

      <div className="app-card mb-6 p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold text-app-white">Buscar ID dos Grupos</h2>
            <p className="mt-1 text-sm text-app-muted">Digite os nomes dos grupos do WhatsApp para localizar os IDs.</p>
          </div>
          <button type="button" className="app-button-secondary self-start sm:self-auto" onClick={addGroupIdField} aria-label="Adicionar grupo">
            <Plus size={18} />
          </button>
        </div>

        <div className="mb-4 rounded-md border border-[#f59e0b]/50 bg-[#451a03] p-3 text-sm leading-6 text-[#fef3c7]">
          <span className="mr-2" aria-hidden="true">
            ⚠️
          </span>
          Atenção: Digite o nome EXATO do grupo como aparece no WhatsApp, incluindo letras maiúsculas, minúsculas, espaços e emojis. Qualquer diferença impedirá a localização do grupo.
        </div>

        <div className="grid gap-3">
          {groupIdFields.map((field, index) => (
            <div key={index} className="flex gap-2">
              <input
                className="app-input"
                value={field}
                onChange={(event) => updateGroupIdField(index, event.target.value)}
                placeholder="Nome do grupo do WhatsApp"
              />
              {groupIdFields.length > 1 ? (
                <button
                  type="button"
                  className="rounded-md border border-app-border bg-app-card p-2.5 text-app-white transition hover:border-red-500 hover:text-red-400"
                  onClick={() => removeGroupIdField(index)}
                  aria-label="Remover grupo"
                >
                  <X size={18} />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <button type="button" className="app-button mt-4" onClick={searchGroupIds} disabled={searchingGroupIds}>
          {searchingGroupIds ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
          Procurar ID
        </button>

        {groupIdResults.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-md border border-app-border">
            <div className="hidden grid-cols-[1.4fr_1.2fr_auto] gap-3 border-b border-app-border bg-app-panel px-3 py-2 text-xs font-bold uppercase text-app-muted sm:grid">
              <span>Nome do grupo</span>
              <span>ID retornado</span>
              <span>Status</span>
            </div>
            <div className="divide-y divide-app-border">
              {groupIdResults.map((result) => {
                const found = result.status === "ativo";

                return (
                  <div key={`${result.nome_do_grupo}-${result.id_do_grupo ?? "empty"}`} className="grid gap-2 px-3 py-3 text-sm sm:grid-cols-[1.4fr_1.2fr_auto] sm:items-center">
                    <span className="font-semibold text-app-white">{result.nome_do_grupo}</span>
                    <span className="break-all text-app-muted">{result.id_do_grupo ?? "-"}</span>
                    <span
                      className={`w-fit rounded-md border px-2 py-1 text-xs font-bold ${
                        found
                          ? "border-app-green bg-app-panel text-app-green"
                          : "border-red-500 bg-app-panel text-red-400"
                      }`}
                    >
                      {found ? "Encontrado" : "Não encontrado"}
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
      ) : grupos.length === 0 ? (
        <div className="app-card p-6 text-sm text-app-muted">Nenhum grupo cadastrado.</div>
      ) : (
        <div className="grid gap-3">
          {grupos.map((grupo) => (
            <article key={grupo.id} className="app-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-bold text-app-white">{grupo.nome}</h2>
                <a className="mt-1 block break-all text-sm text-app-muted hover:text-app-green" href={grupo.link} target="_blank">
                  {grupo.link}
                </a>
              </div>
              <button onClick={() => deleteGrupo(grupo.id)} className="app-button-secondary">
                <Trash2 size={18} />
                Excluir
              </button>
            </article>
          ))}
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
      status: "não encontrado"
    }));
  }

  return requestedNames.map((name, index) => {
    const item = findGroupIdItem(rawItems, name, index);
    const id = getStringValue(item, ["id_do_grupo", "id_grupo", "group_id", "grupo_id", "id", "jid"]);
    const status = getStringValue(item, ["status"]);
    const found = Boolean(id) && !status.toLowerCase().includes("nao") && !status.toLowerCase().includes("não");

    return {
      nome_do_grupo: getStringValue(item, ["nome_do_grupo", "nome", "grupo", "name"]) || name,
      id_do_grupo: id || null,
      status: found ? "ativo" : "não encontrado"
    };
  });
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
