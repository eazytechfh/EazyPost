"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Shield, ShieldOff, Trash2, UserPlus, X } from "lucide-react";
import {
  createUserAction,
  deleteUserAction,
  listUsersAction,
  toggleAdminAction
} from "@/app/actions/admin";
import { SectionHeader } from "./section-header";

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
