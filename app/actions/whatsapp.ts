"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getUazapiBaseUrl, getUazapiToken } from "@/lib/env";

type ActionResult<T> = { data: T; error?: never } | { data?: never; error: string };

type InstanciaRow = {
  id: string;
  nome: string;
  token: string;
  status: string;
  created_at: string;
};

// Helpers UAZAPI -----------------------------------------------------------

function uazapiHeaders(instanceToken: string) {
  return {
    "Content-Type": "application/json",
    token: instanceToken
  };
}

async function uazapiFetch(
  path: string,
  method: string,
  token: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; status: number }> {
  const base = getUazapiBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: uazapiHeaders(token),
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

// --------------------------------------------------------------------------
// Listar instâncias salvas no banco
// --------------------------------------------------------------------------
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

// --------------------------------------------------------------------------
// Criar nova instância na UAZAPI e salvar no banco
// --------------------------------------------------------------------------
export async function criarInstanciaAction(nome: string): Promise<ActionResult<InstanciaRow>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  if (!nome.trim()) return { error: "Nome da instancia obrigatorio." };

  const globalToken = getUazapiToken();

  // POST /instance — cria a instância na UAZAPI
  const { ok, data, status } = await uazapiFetch("/instance", "POST", globalToken, { name: nome.trim() });

  if (!ok) {
    const msg = (data as Record<string, unknown>)?.message ?? (data as Record<string, unknown>)?.error ?? `HTTP ${status}`;
    return { error: `UAZAPI: ${msg}` };
  }

  // A UAZAPI retorna o token da instância (campo "token" ou "apikey" dependendo da versão)
  const payload = data as Record<string, unknown>;
  const instanceToken =
    (payload.token as string) ??
    (payload.apikey as string) ??
    (payload.key as string) ??
    "";

  if (!instanceToken) {
    return { error: "UAZAPI nao retornou token da instancia." };
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

  return { data: inserted as InstanciaRow };
}

// --------------------------------------------------------------------------
// Conectar instância — retorna QR code base64
// --------------------------------------------------------------------------
export async function conectarInstanciaAction(
  instanciaId: string
): Promise<ActionResult<{ qrcode: string }>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  const { data: inst, error: fetchErr } = await supabase
    .from("whatsapp_instancias")
    .select("token")
    .eq("id", instanciaId)
    .single();

  if (fetchErr || !inst) return { error: "Instancia nao encontrada." };

  const token = (inst as { token: string }).token;

  const { ok, data, status } = await uazapiFetch("/instance/connect", "POST", token);

  if (!ok) {
    const msg = (data as Record<string, unknown>)?.message ?? `HTTP ${status}`;
    return { error: `UAZAPI: ${msg}` };
  }

  const payload = data as Record<string, unknown>;
  // UAZAPI pode retornar "qrcode", "qr", "base64" etc.
  const qrcode =
    (payload.qrcode as string) ??
    (payload.qr as string) ??
    (payload.base64 as string) ??
    "";

  if (!qrcode) return { error: "UAZAPI nao retornou QR code." };

  // Atualiza status para "aguardando"
  await supabase
    .from("whatsapp_instancias")
    .update({ status: "aguardando" })
    .eq("id", instanciaId);

  return { data: { qrcode } };
}

// --------------------------------------------------------------------------
// Verificar status da instância na UAZAPI
// --------------------------------------------------------------------------
export async function verificarStatusAction(
  instanciaId: string
): Promise<ActionResult<{ conectado: boolean; status: string }>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  const { data: inst, error: fetchErr } = await supabase
    .from("whatsapp_instancias")
    .select("token")
    .eq("id", instanciaId)
    .single();

  if (fetchErr || !inst) return { error: "Instancia nao encontrada." };

  const token = (inst as { token: string }).token;

  const { ok, data, status } = await uazapiFetch("/instance/status", "GET", token);

  if (!ok) {
    const msg = (data as Record<string, unknown>)?.message ?? `HTTP ${status}`;
    return { error: `UAZAPI: ${msg}` };
  }

  const payload = data as Record<string, unknown>;
  // UAZAPI retorna "connected", "state", "status" — normaliza
  const state =
    (payload.connected as boolean) === true ||
    (payload.state as string) === "open" ||
    (payload.status as string) === "connected" ||
    (payload.status as string) === "open";

  const statusLabel = state ? "conectado" : "desconectado";

  // Sincroniza status no banco
  await supabase
    .from("whatsapp_instancias")
    .update({ status: statusLabel })
    .eq("id", instanciaId);

  return { data: { conectado: state, status: statusLabel } };
}

// --------------------------------------------------------------------------
// Desconectar instância
// --------------------------------------------------------------------------
export async function desconectarInstanciaAction(instanciaId: string): Promise<ActionResult<boolean>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  const { data: inst, error: fetchErr } = await supabase
    .from("whatsapp_instancias")
    .select("token")
    .eq("id", instanciaId)
    .single();

  if (fetchErr || !inst) return { error: "Instancia nao encontrada." };

  const token = (inst as { token: string }).token;

  const { ok, data, status } = await uazapiFetch("/instance/disconnect", "POST", token);

  if (!ok) {
    const msg = (data as Record<string, unknown>)?.message ?? `HTTP ${status}`;
    return { error: `UAZAPI: ${msg}` };
  }

  await supabase
    .from("whatsapp_instancias")
    .update({ status: "desconectado" })
    .eq("id", instanciaId);

  return { data: true };
}

// --------------------------------------------------------------------------
// Deletar instância (UAZAPI + banco)
// --------------------------------------------------------------------------
export async function deletarInstanciaAction(instanciaId: string): Promise<ActionResult<boolean>> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  const { data: inst, error: fetchErr } = await supabase
    .from("whatsapp_instancias")
    .select("token")
    .eq("id", instanciaId)
    .single();

  if (fetchErr || !inst) return { error: "Instancia nao encontrada." };

  const token = (inst as { token: string }).token;

  // Tenta deletar na UAZAPI (ignora erros — remove do banco de qualquer forma)
  await uazapiFetch("/instance", "DELETE", token).catch(() => null);

  const { error: dbErr } = await supabase
    .from("whatsapp_instancias")
    .delete()
    .eq("id", instanciaId);

  if (dbErr) return { error: dbErr.message };

  return { data: true };
}
