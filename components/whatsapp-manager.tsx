"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
  Unplug,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import {
  conectarInstanciaAction,
  criarInstanciaAction,
  deletarInstanciaAction,
  desconectarInstanciaAction,
  listarInstanciasAction,
  verificarStatusAction
} from "@/app/actions/whatsapp";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
type Instancia = {
  id: string;
  nome: string;
  token: string;
  status: string;
  created_at: string;
};

type StatusType = "conectado" | "aguardando" | "desconectado";

function normalizeStatus(s: string): StatusType {
  if (s === "conectado") return "conectado";
  if (s === "aguardando") return "aguardando";
  return "desconectado";
}

const STATUS_CONFIG: Record<StatusType, { label: string; color: string; Icon: React.ElementType }> = {
  conectado: { label: "Conectado", color: "text-app-green border-app-green bg-app-green/10", Icon: Wifi },
  aguardando: { label: "Aguardando QR", color: "text-yellow-400 border-yellow-500 bg-yellow-500/10", Icon: QrCode },
  desconectado: { label: "Desconectado", color: "text-app-muted border-app-border bg-transparent", Icon: WifiOff }
};

// ---------------------------------------------------------------------------
// Componente de badge de status
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: string }) {
  const s = normalizeStatus(status);
  const { label, color, Icon } = STATUS_CONFIG[s];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      <Icon size={11} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card de instância
// ---------------------------------------------------------------------------
function InstanciaCard({
  instancia,
  onDeleted,
  onStatusChange
}: {
  instancia: Instancia;
  onDeleted: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const [loading, setLoading] = useState<"conectar" | "desconectar" | "deletar" | null>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Para o polling ao desmontar
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  function startPolling(id: string) {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const result = await verificarStatusAction(id);
      if (result.data?.conectado) {
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
        setQrcode(null);
        onStatusChange(id, "conectado");
      }
    }, 4000);
  }

  async function handleConectar() {
    setLoading("conectar");
    setErro(null);
    const result = await conectarInstanciaAction(instancia.id);
    setLoading(null);

    if (result.error) {
      setErro(result.error);
      return;
    }

    setQrcode(result.data?.qrcode ?? null);
    onStatusChange(instancia.id, "aguardando");
    startPolling(instancia.id);
  }

  async function handleDesconectar() {
    setLoading("desconectar");
    setErro(null);
    setQrcode(null);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    const result = await desconectarInstanciaAction(instancia.id);
    setLoading(null);

    if (result.error) {
      setErro(result.error);
      return;
    }

    onStatusChange(instancia.id, "desconectado");
  }

  async function handleDeletar() {
    setLoading("deletar");
    setErro(null);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    const result = await deletarInstanciaAction(instancia.id);
    setLoading(null);

    if (result.error) {
      setErro(result.error);
      setConfirmDelete(false);
      return;
    }

    onDeleted(instancia.id);
  }

  const status = normalizeStatus(instancia.status);
  const isLoading = loading !== null;

  return (
    <div className="rounded-lg border border-app-border bg-app-panel flex flex-col overflow-hidden">
      {/* Cabeçalho do card */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-app-border bg-app-card text-app-muted">
            <Smartphone size={20} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-app-white">{instancia.nome}</p>
            <StatusBadge status={instancia.status} />
          </div>
        </div>

        {/* Botão deletar */}
        <div className="flex items-center gap-2 shrink-0">
          {confirmDelete ? (
            <>
              <button
                onClick={handleDeletar}
                disabled={isLoading}
                className="flex items-center gap-1.5 rounded-md border border-red-500 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition"
              >
                {loading === "deletar" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Confirmar
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={isLoading}
                className="rounded-md border border-app-border bg-app-card p-1.5 text-app-muted hover:text-app-white disabled:opacity-50 transition"
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={isLoading}
              className="rounded-md border border-app-border bg-app-card p-1.5 text-app-muted hover:border-red-500 hover:text-red-400 disabled:opacity-50 transition"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {/* QR Code */}
      {qrcode ? (
        <div className="border-t border-app-border bg-app-card p-4 flex flex-col items-center gap-3">
          <p className="text-xs text-app-muted text-center">
            Escaneie o QR code com o WhatsApp
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrcode.startsWith("data:") ? qrcode : `data:image/png;base64,${qrcode}`}
            alt="QR Code WhatsApp"
            className="h-48 w-48 rounded-md border border-app-border object-contain"
          />
          <p className="flex items-center gap-1.5 text-xs text-yellow-400">
            <Loader2 size={12} className="animate-spin" />
            Aguardando conexão...
          </p>
        </div>
      ) : null}

      {/* Erro */}
      {erro ? (
        <p className="mx-4 mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {erro}
        </p>
      ) : null}

      {/* Ações */}
      <div className="border-t border-app-border p-3 flex gap-2">
        {status !== "conectado" ? (
          <button
            onClick={handleConectar}
            disabled={isLoading}
            className="flex flex-1 items-center justify-center gap-2 rounded-md border border-app-green bg-app-green/10 py-2 text-sm font-semibold text-app-green hover:bg-app-green/20 disabled:opacity-50 transition"
          >
            {loading === "conectar" ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <QrCode size={15} />
            )}
            {status === "aguardando" ? "Novo QR Code" : "Conectar"}
          </button>
        ) : (
          <button
            onClick={handleDesconectar}
            disabled={isLoading}
            className="flex flex-1 items-center justify-center gap-2 rounded-md border border-app-border bg-app-card py-2 text-sm font-semibold text-app-muted hover:border-red-500 hover:text-red-400 disabled:opacity-50 transition"
          >
            {loading === "desconectar" ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Unplug size={15} />
            )}
            Desconectar
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal criar instância
// ---------------------------------------------------------------------------
function CriarInstanciaModal({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (inst: Instancia) => void;
}) {
  const [nome, setNome] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setLoading(true);
    setErro(null);

    const result = await criarInstanciaAction(nome.trim());
    setLoading(false);

    if (result.error) {
      setErro(result.error);
      return;
    }

    onCreated(result.data as Instancia);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-sm rounded-lg border border-app-border bg-app-panel p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-app-white">Nova Instância</h2>
          <button onClick={onClose} className="text-app-muted hover:text-app-white transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block space-y-2">
            <span className="app-label">Nome da instância</span>
            <input
              ref={inputRef}
              className="app-input"
              placeholder="Ex: Vendas, Suporte..."
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              maxLength={60}
            />
          </label>

          {erro ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {erro}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="app-button-secondary flex-1"
            >
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="app-button flex-1">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {loading ? "Criando..." : "Criar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function WhatsappManager() {
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);

  const loadInstancias = useCallback(async () => {
    const result = await listarInstanciasAction();
    if (result.error) {
      setErro(result.error);
    } else {
      setInstancias(result.data ?? []);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void loadInstancias();
  }, [loadInstancias]);

  async function handleRefresh() {
    setAtualizando(true);
    await loadInstancias();
    setAtualizando(false);
  }

  function handleDeleted(id: string) {
    setInstancias((prev) => prev.filter((i) => i.id !== id));
  }

  function handleStatusChange(id: string, status: string) {
    setInstancias((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status } : i))
    );
  }

  function handleCreated(inst: Instancia) {
    setInstancias((prev) => [...prev, inst]);
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-app-white">Conectar WhatsApp</h1>
          <p className="text-sm text-app-muted">Gerencie as instâncias WhatsApp para disparo de anúncios</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={atualizando || carregando}
            className="flex items-center gap-2 rounded-md border border-app-border bg-app-card px-3 py-2 text-sm font-semibold text-app-muted hover:text-app-white disabled:opacity-50 transition"
          >
            <RefreshCw size={15} className={atualizando ? "animate-spin" : ""} />
            Atualizar
          </button>
          <button
            onClick={() => setCriando(true)}
            className="app-button"
          >
            <Plus size={15} />
            Nova Instância
          </button>
        </div>
      </div>

      {/* Estado de carregamento */}
      {carregando ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-app-muted" />
        </div>
      ) : erro ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-sm text-red-400">{erro}</p>
          <button onClick={handleRefresh} className="mt-3 text-xs text-app-muted underline hover:text-app-white">
            Tentar novamente
          </button>
        </div>
      ) : instancias.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-app-border py-20 text-center">
          <Smartphone size={40} className="mb-4 text-app-border" />
          <p className="font-semibold text-app-white">Nenhuma instância criada</p>
          <p className="mt-1 text-sm text-app-muted">Crie uma instância para conectar seu WhatsApp</p>
          <button onClick={() => setCriando(true)} className="app-button mt-5">
            <Plus size={15} />
            Nova Instância
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {instancias.map((inst) => (
            <InstanciaCard
              key={inst.id}
              instancia={inst}
              onDeleted={handleDeleted}
              onStatusChange={handleStatusChange}
            />
          ))}

          {/* Card de adicionar nova */}
          <button
            onClick={() => setCriando(true)}
            className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-app-border bg-transparent text-app-muted transition hover:border-app-green hover:text-app-green"
          >
            <Plus size={24} />
            <span className="text-sm font-semibold">Nova Instância</span>
          </button>
        </div>
      )}

      {/* Modal criar */}
      {criando ? (
        <CriarInstanciaModal
          onClose={() => setCriando(false)}
          onCreated={handleCreated}
        />
      ) : null}
    </div>
  );
}
