"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Layers, Loader2, Shield, ShieldOff, Trash2, UserPlus, X } from "lucide-react";
import {
  createUserAction,
  deleteUserAction,
  getHorasPermitidasAction,
  listUsersAction,
  toggleAdminAction,
  updateHorasPermitidasAction
} from "@/app/actions/admin";
import { compactarLotesAction, rebalancearLotesAction } from "@/app/actions/lotes";
import { SectionHeader } from "./section-header";

const TODAS_AS_HORAS = Array.from({ length: 24 }, (_, h) => h);

type UserRow = {
  id: string;
  email: string;
  created_at: string;
  is_admin: boolean;
};

export function AdminUsuarios() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rebalancing, setRebalancing] = useState(false);
  const [rebalanceResult, setRebalanceResult] = useState<{
    lotesAfetados: number;
    veiculosMigrados: number;
    novosLotesCriados: number;
    error?: string;
  } | null>(null);
  const [confirmRebalance, setConfirmRebalance] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactResult, setCompactResult] = useState<{
    veiculosRealocados: number;
    lotesRemovidos: number;
    error?: string;
  } | null>(null);
  const [confirmCompact, setConfirmCompact] = useState(false);

  const [horasPermitidas, setHorasPermitidas] = useState<number[]>([]);
  const [horasLoading, setHorasLoading] = useState(true);
  const [horasSaving, setHorasSaving] = useState(false);
  const [horasMessage, setHorasMessage] = useState("");

  const loadHoras = useCallback(async () => {
    setHorasLoading(true);
    const result = await getHorasPermitidasAction();
    if (result.error) {
      setHorasMessage(result.error);
    } else {
      setHorasPermitidas(result.data ?? []);
    }
    setHorasLoading(false);
  }, []);

  useEffect(() => { void loadHoras(); }, [loadHoras]);

  function toggleHora(hora: number) {
    setHorasPermitidas((prev) =>
      prev.includes(hora) ? prev.filter((h) => h !== hora) : [...prev, hora].sort((a, b) => a - b)
    );
  }

  async function handleSalvarHoras() {
    setHorasSaving(true);
    setHorasMessage("");
    const result = await updateHorasPermitidasAction(horasPermitidas);
    setHorasSaving(false);
    if (result.error) {
      setHorasMessage(result.error);
    } else {
      setHorasMessage("Horários permitidos atualizados com sucesso.");
      await loadHoras();
    }
  }

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const result = await listUsersAction();
    if (result.error) {
      setMessage(result.error);
    } else {
      setUsers(result.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setMessage("");
    const result = await createUserAction(newEmail, newPassword);
    setCreating(false);
    if (result.error) {
      setMessage(result.error);
    } else {
      setShowCreate(false);
      setNewEmail("");
      setNewPassword("");
      setMessage("Usuário criado com sucesso.");
      await loadUsers();
    }
  }

  async function handleDelete(userId: string) {
    setDeletingId(userId);
    setMessage("");
    const result = await deleteUserAction(userId);
    setDeletingId(null);
    setConfirmDeleteId(null);
    if (result.error) {
      setMessage(result.error);
    } else {
      setMessage("Usuário removido.");
      await loadUsers();
    }
  }

  async function handleToggleAdmin(userId: string, currentIsAdmin: boolean) {
    setTogglingId(userId);
    setMessage("");
    const result = await toggleAdminAction(userId, !currentIsAdmin);
    setTogglingId(null);
    if (result.error) {
      setMessage(result.error);
    } else {
      await loadUsers();
    }
  }

  async function handleRebalancear() {
    setRebalancing(true);
    setRebalanceResult(null);
    const result = await rebalancearLotesAction();
    setRebalanceResult(result);
    setRebalancing(false);
    setConfirmRebalance(false);
  }

  async function handleCompactar() {
    setCompacting(true);
    setCompactResult(null);
    const result = await compactarLotesAction();
    setCompactResult(result);
    setCompacting(false);
    setConfirmCompact(false);
  }

  return (
    <section>
      <SectionHeader
        title="Gerenciar Usuários"
        description="Crie e gerencie os usuários que têm acesso ao sistema."
      />

      {message ? (
        <p className="mb-4 rounded-md border border-app-border bg-app-panel p-3 text-sm text-app-muted">
          {message}
        </p>
      ) : null}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-app-muted">
          {loading ? "Carregando..." : `${users.length} usuário${users.length !== 1 ? "s" : ""} cadastrado${users.length !== 1 ? "s" : ""}`}
        </p>
        <button className="app-button" onClick={() => setShowCreate(true)}>
          <UserPlus size={18} />
          Criar Usuário
        </button>
      </div>

      {loading ? (
        <div className="app-card p-6 text-sm text-app-muted flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          Carregando usuários...
        </div>
      ) : users.length === 0 ? (
        <div className="app-card p-6 text-sm text-app-muted">Nenhum usuário cadastrado.</div>
      ) : (
        <div className="app-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-app-muted">Email</th>
                  <th className="px-4 py-3 text-xs font-semibold text-app-muted">Criado em</th>
                  <th className="px-4 py-3 text-xs font-semibold text-app-muted">Perfil</th>
                  <th className="px-4 py-3 text-xs font-semibold text-app-muted text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-app-border last:border-0 transition hover:bg-app-card/30"
                  >
                    <td className="px-4 py-3 font-medium text-app-white">{user.email}</td>
                    <td className="px-4 py-3 text-app-muted">
                      {new Date(user.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3">
                      {user.is_admin ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-xs font-bold text-yellow-400">
                          <Shield size={11} />
                          Admin
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-app-border px-2 py-0.5 text-xs text-app-muted">
                          Usuário
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {/* Toggle admin */}
                        <button
                          onClick={() => void handleToggleAdmin(user.id, user.is_admin)}
                          disabled={togglingId === user.id}
                          title={user.is_admin ? "Remover permissão admin" : "Tornar administrador"}
                          className={`rounded-md border p-1.5 transition ${
                            user.is_admin
                              ? "border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10"
                              : "border-app-border text-app-muted hover:border-yellow-500 hover:text-yellow-400"
                          }`}
                        >
                          {togglingId === user.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : user.is_admin ? (
                            <ShieldOff size={14} />
                          ) : (
                            <Shield size={14} />
                          )}
                        </button>

                        {/* Delete com confirmação */}
                        {confirmDeleteId === user.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-app-muted">Confirmar?</span>
                            <button
                              onClick={() => void handleDelete(user.id)}
                              disabled={deletingId === user.id}
                              className="rounded-md border border-red-500/40 bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20"
                            >
                              {deletingId === user.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Check size={14} />
                              )}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-md border border-app-border p-1.5 text-app-muted hover:border-app-green hover:text-app-white"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(user.id)}
                            title="Remover usuário"
                            className="rounded-md border border-app-border p-1.5 text-app-muted transition hover:border-red-500 hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Horários permitidos de disparo automático */}
      <div className="mt-10">
        <h3 className="mb-1 text-sm font-semibold text-app-white">Horários de Disparo Automático</h3>
        <p className="mb-4 text-xs text-app-muted">
          O sistema só dispara lotes automaticamente nos horários selecionados abaixo (horário de Brasília).
          Os lotes seguem em sequência entre os dias, sem reiniciar — a fila só reinicia quando todos os lotes
          já tiverem sido disparados.
        </p>

        {horasMessage ? (
          <p className={`mb-3 rounded-md border p-3 text-sm ${horasMessage.includes("sucesso") ? "border-app-green/40 bg-app-green/10 text-app-green" : "border-red-500/40 bg-red-500/10 text-red-400"}`}>
            {horasMessage}
          </p>
        ) : null}

        {horasLoading ? (
          <div className="app-card p-6 text-sm text-app-muted flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Carregando horários...
          </div>
        ) : (
          <div className="app-card p-4">
            <div className="mb-4 grid grid-cols-6 gap-2 sm:grid-cols-8 md:grid-cols-12">
              {TODAS_AS_HORAS.map((hora) => {
                const ativo = horasPermitidas.includes(hora);
                return (
                  <button
                    key={hora}
                    type="button"
                    onClick={() => toggleHora(hora)}
                    className={`rounded-md border px-2 py-2 text-xs font-semibold transition ${
                      ativo
                        ? "border-app-green bg-app-green/10 text-app-green"
                        : "border-app-border text-app-muted hover:border-app-green/50"
                    }`}
                  >
                    {String(hora).padStart(2, "0")}h
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => void handleSalvarHoras()}
              disabled={horasSaving}
              className="app-button"
            >
              {horasSaving ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />}
              Salvar Horários
            </button>
          </div>
        )}
      </div>

      {/* Manutenção de Lotes */}
      <div className="mt-10">
        <h3 className="mb-1 text-sm font-semibold text-app-white">Manutenção de Lotes</h3>
        <p className="mb-4 text-xs text-app-muted">
          Move os veículos excedentes (além de 10 por lote) para lotes com espaço disponível ou cria novos lotes automaticamente.
        </p>

        {rebalanceResult ? (
          <div className={`mb-4 rounded-md border p-3 text-sm ${rebalanceResult.error ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-app-green/40 bg-app-green/10 text-app-green"}`}>
            {rebalanceResult.error ? (
              rebalanceResult.error
            ) : rebalanceResult.veiculosMigrados === 0 ? (
              "Nenhum lote com excesso encontrado. Todos os lotes já têm 10 veículos ou menos."
            ) : (
              <>
                <span className="font-bold">{rebalanceResult.veiculosMigrados}</span> veículo{rebalanceResult.veiculosMigrados !== 1 ? "s" : ""} redistribuído{rebalanceResult.veiculosMigrados !== 1 ? "s" : ""} de{" "}
                <span className="font-bold">{rebalanceResult.lotesAfetados}</span> lote{rebalanceResult.lotesAfetados !== 1 ? "s" : ""}.
                {rebalanceResult.novosLotesCriados > 0 && (
                  <> <span className="font-bold">{rebalanceResult.novosLotesCriados}</span> novo{rebalanceResult.novosLotesCriados !== 1 ? "s lotes criados" : " lote criado"}.</>
                )}
              </>
            )}
          </div>
        ) : null}

        {confirmRebalance ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-app-muted">Confirmar rebalanceamento?</span>
            <button
              onClick={() => void handleRebalancear()}
              disabled={rebalancing}
              className="flex items-center gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm font-semibold text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-50 transition"
            >
              {rebalancing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Confirmar
            </button>
            <button
              onClick={() => setConfirmRebalance(false)}
              className="rounded-md border border-app-border px-3 py-2 text-sm text-app-muted hover:text-app-white transition"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setConfirmRebalance(true); setRebalanceResult(null); }}
            className="flex items-center gap-2 rounded-md border border-app-border bg-app-card px-3 py-2 text-sm font-semibold text-app-muted hover:border-yellow-500 hover:text-yellow-400 transition"
          >
            <Layers size={14} />
            Rebalancear Lotes
          </button>
        )}
      </div>

      {/* Compactação de Lotes */}
      <div className="mt-10">
        <h3 className="mb-1 text-sm font-semibold text-app-white">Compactar Lotes</h3>
        <p className="mb-4 text-xs text-app-muted">
          Puxa veículos dos lotes seguintes para fechar buracos deixados por vendas no meio da
          sequência (ex: Lote 11 vazio enquanto o Lote 18 ainda tem veículo). A sobra fica sempre
          concentrada no(s) último(s) lote(s), e lotes finais que ficam vazios são removidos. Isso
          já acontece automaticamente a cada venda — use este botão só se notar buracos antigos.
        </p>

        {compactResult ? (
          <div className={`mb-4 rounded-md border p-3 text-sm ${compactResult.error ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-app-green/40 bg-app-green/10 text-app-green"}`}>
            {compactResult.error ? (
              compactResult.error
            ) : compactResult.veiculosRealocados === 0 && compactResult.lotesRemovidos === 0 ? (
              "Nenhum buraco encontrado. A sequência de lotes já está compactada."
            ) : (
              <>
                <span className="font-bold">{compactResult.veiculosRealocados}</span> veículo{compactResult.veiculosRealocados !== 1 ? "s" : ""} realocado{compactResult.veiculosRealocados !== 1 ? "s" : ""}.
                {compactResult.lotesRemovidos > 0 && (
                  <> <span className="font-bold">{compactResult.lotesRemovidos}</span> lote{compactResult.lotesRemovidos !== 1 ? "s vazios removidos" : " vazio removido"}.</>
                )}
              </>
            )}
          </div>
        ) : null}

        {confirmCompact ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-app-muted">Confirmar compactação?</span>
            <button
              onClick={() => void handleCompactar()}
              disabled={compacting}
              className="flex items-center gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm font-semibold text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-50 transition"
            >
              {compacting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Confirmar
            </button>
            <button
              onClick={() => setConfirmCompact(false)}
              className="rounded-md border border-app-border px-3 py-2 text-sm text-app-muted hover:text-app-white transition"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setConfirmCompact(true); setCompactResult(null); }}
            className="flex items-center gap-2 rounded-md border border-app-border bg-app-card px-3 py-2 text-sm font-semibold text-app-muted hover:border-yellow-500 hover:text-yellow-400 transition"
          >
            <Layers size={14} />
            Compactar Lotes
          </button>
        )}
      </div>

      {/* Modal criar usuário */}
      {showCreate ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-app-black/80 px-4">
          <div className="w-full max-w-md rounded-lg border border-app-border bg-app-panel p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="text-lg font-bold text-app-white">Criar Usuário</h2>
              <button
                onClick={() => { setShowCreate(false); setNewEmail(""); setNewPassword(""); }}
                className="rounded-md border border-app-border bg-app-card p-2 text-app-white hover:border-app-green"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <label className="block space-y-2">
                <span className="app-label">Email</span>
                <input
                  className="app-input"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="usuario@email.com"
                  required
                  autoFocus
                />
              </label>
              <label className="block space-y-2">
                <span className="app-label">Senha</span>
                <input
                  className="app-input"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="mínimo 6 caracteres"
                  minLength={6}
                  required
                />
              </label>
              <p className="text-xs text-app-muted">
                O usuário poderá fazer login imediatamente com essas credenciais.
              </p>
              <button className="app-button w-full" type="submit" disabled={creating}>
                {creating ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
                Criar Usuário
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
