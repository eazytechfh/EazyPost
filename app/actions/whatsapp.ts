"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getUazapiBaseUrl, getUazapiToken } from "@/lib/env";
import { registrarLogComCliente } from "@/lib/audit-log";

type ActionResult<T> = { data: T; error?: never } | { data?: never; error: string };

type InstanciaRow = {
  id: string;
  nome: string;
  token: string;
  status: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Helpers UAZAPI
// ---------------------------------------------------------------------------

/**
 * Requisição administrativa (criação de instâncias).
 * Usa o header "admintoken" com o token global de admin da UAZAPI.
 */
async function uazapiAdmin(
  path: string,
  method: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; status: number }> {
  const base = getUazapiBaseUrl();
  const adminToken = getUazapiToken();

  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      admintoken: adminToken
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // resposta sem corpo
  }
  return { ok: res.ok, data, status: res.status };
}

/**
 * Requisição de instância específica.
 * Usa o header "token" com o token individual da instância.
 */
async function uazapiInstance(
  path: string,
  method: string,
  instanceToken: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; status: number }> {
  const base = getUazapiBaseUrl();

  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      token: instanceToken
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // resposta sem corpo
  }
  return { ok: res.ok, data, status: res.status };
}

function extractError(data: unknown, httpStatus: number): string {
  const d = data as Record<string, unknown> | null;
  return String(d?.message ?? d?.error ?? d?.msg ?? `HTTP ${httpStatus}`);
}

// ---------------------------------------------------------------------------
// Buscar token de instância no banco
// ---------------------------------------------------------------------------
async function getInstanceToken(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  instanciaId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("whatsapp_instancias")
    .select("token")
    .eq("id", instanciaId)
    .single();
  return (data as { token: string } | null)?.token ?? null;
}

// ---------------------------------------------------------------------------
// Listar instâncias salvas no banco
// ---------------------------------------------------------------------------
export async function listarInstanciasAction(): Promise<ActionResult<InstanciaRow[]>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  const { data, error } = await supabase
    .from("whatsapp_instancias")
    .select("id, nome, token, status, created_at")
    .order("created_at", { ascending: true });

  if (error) return { error: error.message };
  return { data: (data ?? []) as InstanciaRow[] };
}

// ---------------------------------------------------------------------------
// Criar nova instância — POST /instance/create com admintoken
// ---------------------------------------------------------------------------
export async function criarInstanciaAction(nome: string): Promise<ActionResult<InstanciaRow>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  if (!nome.trim()) return { error: "Nome da instancia obrigatorio." };

  // POST /instance/create com admintoken
  const { ok, data, status } = await uazapiAdmin("/instance/create", "POST", {
    name: nome.trim()
  });

  if (!ok) {
    return { error: `UAZAPI: ${extractError(data, status)}` };
  }

  // A UAZAPI retorna o token da instância em "token" ou "apikey"
  const payload = data as Record<string, unknown>;
  const instanceToken =
    (payload.token as string | undefined) ??
    (payload.apikey as string | undefined) ??
    (payload.key as string | undefined) ??
    "";

  if (!instanceToken) {
    return {
      error: `UAZAPI nao retornou token da instancia. Resposta: ${JSON.stringify(data)}`
    };
  }

  // Salva no banco
  const { data: inserted, error: dbErr } = await supabase
    .from("whatsapp_instancias")
    .insert({
      user_id: user.id,
      nome: nome.trim(),
      token: instanceToken,
      status: "desconectado"
    })
    .select("id, nome, token, status, created_at")
    .single();

  if (dbErr || !inserted) return { error: dbErr?.message ?? "Erro ao salvar instancia." };

  await registrarLogComCliente(
    supabase,
    `Usuario criou a instancia WhatsApp [${nome.trim()}]`,
    "whatsapp_instancia",
    inserted.id,
    { nome: nome.trim() }
  );

  return { data: inserted as InstanciaRow };
}

// ---------------------------------------------------------------------------
// Conectar instância — POST /instance/connect com token da instância
// ---------------------------------------------------------------------------
export async function conectarInstanciaAction(
  instanciaId: string
): Promise<ActionResult<{ qrcode: string }>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  const instanceToken = await getInstanceToken(supabase, instanciaId);
  if (!instanceToken) return { error: "Instancia nao encontrada." };

  const { ok, data, status } = await uazapiInstance("/instance/connect", "POST", instanceToken);

  if (!ok) {
    return { error: `UAZAPI: ${extractError(data, status)}` };
  }

  const payload = data as Record<string, unknown>;
  const qrcode =
    (payload.qrcode as string | undefined) ??
    (payload.qr as string | undefined) ??
    (payload.base64 as string | undefined) ??
    (payload.qrCode as string | undefined) ??
    "";

  if (!qrcode) {
    return {
      error: `UAZAPI nao retornou QR code. Resposta: ${JSON.stringify(data)}`
    };
  }

  await supabase
    .from("whatsapp_instancias")
    .update({ status: "aguardando" })
    .eq("id", instanciaId);

  await registrarLogComCliente(
    supabase,
    "Usuario solicitou conexao de instancia WhatsApp",
    "whatsapp_instancia",
    instanciaId,
    { status: "aguardando" }
  );

  return { data: { qrcode } };
}

// ---------------------------------------------------------------------------
// Verificar status da instância — GET /instance/status com token da instância
// ---------------------------------------------------------------------------
export async function verificarStatusAction(
  instanciaId: string
): Promise<ActionResult<{ conectado: boolean; status: string }>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  const instanceToken = await getInstanceToken(supabase, instanciaId);
  if (!instanceToken) return { error: "Instancia nao encontrada." };

  const { ok, data, status } = await uazapiInstance("/instance/status", "GET", instanceToken);

  if (!ok) {
    return { error: `UAZAPI: ${extractError(data, status)}` };
  }

  const payload = data as Record<string, unknown>;
  const conectado =
    (payload.connected as boolean) === true ||
    (payload.state as string) === "open" ||
    (payload.state as string) === "connected" ||
    (payload.status as string) === "connected" ||
    (payload.status as string) === "open";

  const statusLabel = conectado ? "conectado" : "desconectado";

  await supabase
    .from("whatsapp_instancias")
    .update({ status: statusLabel })
    .eq("id", instanciaId);

  await registrarLogComCliente(
    supabase,
    `Usuario atualizou o status da instancia WhatsApp para [${statusLabel}]`,
    "whatsapp_instancia",
    instanciaId,
    { status: statusLabel }
  );

  return { data: { conectado, status: statusLabel } };
}

// ---------------------------------------------------------------------------
// Desconectar instância — POST /instance/disconnect com token da instância
// ---------------------------------------------------------------------------
export async function desconectarInstanciaAction(
  instanciaId: string
): Promise<ActionResult<boolean>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  const instanceToken = await getInstanceToken(supabase, instanciaId);
  if (!instanceToken) return { error: "Instancia nao encontrada." };

  const { ok, data, status } = await uazapiInstance("/instance/disconnect", "POST", instanceToken);

  if (!ok) {
    return { error: `UAZAPI: ${extractError(data, status)}` };
  }

  await supabase
    .from("whatsapp_instancias")
    .update({ status: "desconectado" })
    .eq("id", instanciaId);

  await registrarLogComCliente(
    supabase,
    "Usuario desconectou a instancia WhatsApp",
    "whatsapp_instancia",
    instanciaId,
    { status: "desconectado" }
  );

  return { data: true };
}

// ---------------------------------------------------------------------------
// Deletar instância — DELETE /instance com token da instância + remove do banco
// ---------------------------------------------------------------------------
export async function deletarInstanciaAction(
  instanciaId: string
): Promise<ActionResult<boolean>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  const instanceToken = await getInstanceToken(supabase, instanciaId);
  if (!instanceToken) return { error: "Instancia nao encontrada." };

  // Tenta deletar na UAZAPI (ignora falha — remove do banco de qualquer forma)
  await uazapiInstance("/instance", "DELETE", instanceToken).catch(() => null);

  const { error: dbErr } = await supabase
    .from("whatsapp_instancias")
    .delete()
    .eq("id", instanciaId);

  if (dbErr) return { error: dbErr.message };

  await registrarLogComCliente(
    supabase,
    "Usuario excluiu a instancia WhatsApp",
    "whatsapp_instancia",
    instanciaId
  );

  return { data: true };
}
