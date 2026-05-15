"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { CalendarClock, Check, Edit3, MoreVertical, Trash2, Users, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { cleanCurrencyInput, formatCurrency, parseCurrencyInput } from "@/lib/format";
import type { AnuncioGrupo, Grupo, Veiculo } from "@/types/database";
import { RichTextEditor } from "./rich-text-editor";
import { SectionHeader } from "./section-header";

type EditState = Pick<Veiculo, "nome_anuncio" | "quilometragem" | "motor" | "cor" | "texto_anuncio"> & {
  valor: string;
};

type LinkedGroupsByVehicle = Record<string, Grupo[]>;

export function VeiculosList() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [linkedGroupsByVehicle, setLinkedGroupsByVehicle] = useState<LinkedGroupsByVehicle>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<Veiculo | null>(null);
  const [editForm, setEditForm] = useState<EditState | null>(null);
  const [groupVehicle, setGroupVehicle] = useState<Veiculo | null>(null);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [programModal, setProgramModal] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [veiculosResult, gruposResult, linksResult] = await Promise.all([
      supabase.from("veiculos").select("*").order("created_at", { ascending: false }),
      supabase.from("grupos").select("*").order("nome", { ascending: true }),
      supabase.from("anuncio_grupos").select("*")
    ]);

    if (veiculosResult.error) {
      setMessage(veiculosResult.error.message);
    } else {
      setVeiculos(veiculosResult.data ?? []);
    }

    if (gruposResult.error) {
      setMessage(gruposResult.error.message);
    } else {
      setGrupos(gruposResult.data ?? []);
      setSelectedGroup(gruposResult.data?.[0]?.id ?? "");
    }

    if (linksResult.error) {
      setMessage(linksResult.error.message);
    } else {
      setLinkedGroupsByVehicle(buildLinkedGroupsMap(linksResult.data ?? [], gruposResult.data ?? []));
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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

    if (!editing || !editForm) {
      return;
    }

    const { error } = await supabase
      .from("veiculos")
      .update({
        ...editForm,
        valor: parseCurrencyInput(editForm.valor),
        updated_at: new Date().toISOString()
      })
      .eq("id", editing.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setEditing(null);
    setEditForm(null);
    await loadData();
  }

  async function deleteVeiculo(id: string) {
    const { error } = await supabase.from("veiculos").delete().eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setVeiculos((current) => current.filter((veiculo) => veiculo.id !== id));
    setOpenMenu(null);
  }

  async function linkGroup(programado: boolean) {
    if (!groupVehicle || !selectedGroup) {
      setMessage("Selecione um grupo para continuar.");
      return;
    }

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage("Sessao expirada. Faca login novamente.");
      return;
    }

    const { error } = await supabase.from("anuncio_grupos").insert({
      veiculo_id: groupVehicle.id,
      grupo_id: selectedGroup,
      user_id: user.id,
      programado,
      programado_em: programado ? new Date().toISOString() : null
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    const grupo = grupos.find((item) => item.id === selectedGroup);
    setGroupVehicle(null);

    if (programado) {
      await programVehicle(groupVehicle, grupo ? [grupo] : []);
    } else if (grupo) {
      setMessage(`Grupo "${grupo.nome}" vinculado ao anuncio.`);
      await loadData();
    } else {
      setMessage("Grupo vinculado ao anuncio.");
      await loadData();
    }
  }

  async function programVehicle(veiculo: Veiculo, extraGroups: Grupo[] = []) {
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

    const linkedGroups = dedupeGroups([...(linkedGroupsByVehicle[veiculo.id] ?? []), ...extraGroups]);
    const groupNames = linkedGroups.map((grupo) => grupo.nome).join(", ");

    if (groupNames) {
      setProgramModal(`Anuncio programado! Em breve ele sera iniciado, acompanhe no grupo: ${groupNames}.`);
    } else {
      setProgramModal("Anuncio programado! Vincule um grupo para acompanhar a divulgacao.");
    }

    await loadData();
  }

  const hasGroups = grupos.length > 0;

  return (
    <section>
      <SectionHeader title="Lista de Veiculos" description="Gerencie anuncios, edicoes e programacoes por grupo." />

      {message ? <p className="mb-4 rounded-md border border-app-border bg-app-panel p-3 text-sm text-app-muted">{message}</p> : null}

      {loading ? (
        <div className="app-card p-6 text-sm text-app-muted">Carregando veiculos...</div>
      ) : veiculos.length === 0 ? (
        <div className="app-card p-6 text-sm text-app-muted">Nenhum veiculo cadastrado.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {veiculos.map((veiculo) => (
            <VehicleCard
              key={veiculo.id}
              veiculo={veiculo}
              linkedGroups={linkedGroupsByVehicle[veiculo.id] ?? []}
              menuOpen={openMenu === veiculo.id}
              onToggleMenu={() => setOpenMenu(openMenu === veiculo.id ? null : veiculo.id)}
              onEdit={() => beginEdit(veiculo)}
              onDelete={() => deleteVeiculo(veiculo.id)}
              onGroups={() => {
                setGroupVehicle(veiculo);
                setOpenMenu(null);
              }}
              onProgram={() => {
                void programVehicle(veiculo);
              }}
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
              <select className="app-input" value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}>
                {grupos.map((grupo) => (
                  <option key={grupo.id} value={grupo.id} className="bg-app-card text-app-white">
                    {grupo.nome}
                  </option>
                ))}
              </select>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button type="button" className="app-button" onClick={() => linkGroup(false)}>
                  <Users size={18} />
                  Vincular Grupo
                </button>
                <button type="button" className="app-button-secondary" onClick={() => linkGroup(true)}>
                  <CalendarClock size={18} />
                  Programar
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
          <button className="app-button mt-5" onClick={() => setProgramModal(null)}>
            Fechar
          </button>
        </Modal>
      ) : null}
    </section>
  );
}

function VehicleCard({
  veiculo,
  linkedGroups,
  menuOpen,
  onToggleMenu,
  onEdit,
  onDelete,
  onGroups,
  onProgram
}: {
  veiculo: Veiculo;
  linkedGroups: Grupo[];
  menuOpen: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onGroups: () => void;
  onProgram: () => void;
}) {
  const thumbnail = useMemo(() => veiculo.imagens?.[0], [veiculo.imagens]);

  return (
    <article className="group app-card relative overflow-visible transition hover:border-app-green">
      <div className="relative aspect-video overflow-hidden rounded-t-lg bg-app-panel">
        {thumbnail ? (
          <Image src={thumbnail} alt={veiculo.nome_anuncio} fill className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-app-muted">Sem imagem</div>
        )}
        <StatusBadge status={veiculo.status} />
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
              onClick={onToggleMenu}
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
              </div>
            ) : null}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <Info label="KM" value={veiculo.quilometragem} />
          <Info label="Motor" value={veiculo.motor} />
          <Info label="Cor" value={veiculo.cor} />
        </dl>
      </div>
    </article>
  );
}

function dedupeGroups(groups: Grupo[]) {
  return groups.filter((grupo, index, list) => list.findIndex((item) => item.id === grupo.id) === index);
}

function buildLinkedGroupsMap(links: AnuncioGrupo[], grupos: Grupo[]) {
  const groupsById = new Map(grupos.map((grupo) => [grupo.id, grupo]));
  const linkedGroupsByVehicle: LinkedGroupsByVehicle = {};

  for (const link of links) {
    const grupo = groupsById.get(link.grupo_id);

    if (!grupo) {
      continue;
    }

    const currentGroups = linkedGroupsByVehicle[link.veiculo_id] ?? [];
    const alreadyLinked = currentGroups.some((item) => item.id === grupo.id);

    if (!alreadyLinked) {
      linkedGroupsByVehicle[link.veiculo_id] = [...currentGroups, grupo];
    }
  }

  return linkedGroupsByVehicle;
}

function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = status.toLowerCase();
  const isActive = normalizedStatus === "ativo";
  const label = isActive ? "Ativo" : "Pendente";

  return (
    <span
      className={`absolute left-3 top-3 rounded-md border px-2 py-1 text-xs font-bold ${
        isActive
          ? "border-app-green bg-app-panel text-app-green"
          : "border-[#f59e0b] bg-app-panel text-[#f59e0b]"
      }`}
    >
      {label}
    </span>
  );
}

function LinkedGroups({ groups }: { groups: Grupo[] }) {
  if (groups.length === 0) {
    return <p className="mt-1 text-xs text-app-muted">Nenhum grupo vinculado</p>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {groups.map((grupo) => (
        <span
          key={grupo.id}
          className="max-w-full truncate rounded-md border border-app-green bg-app-panel px-2 py-1 text-xs font-bold text-app-green"
        >
          {grupo.nome}
        </span>
      ))}
    </div>
  );
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
