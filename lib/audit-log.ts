import { createSupabaseBrowserClient } from "./supabase";
import type { Database } from "@/types/database";

type SupabaseLike = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: unknown;
    }>;
  };
  from: (table: keyof Database["public"]["Tables"] | string) => any;
};

export type AuditDetails = Record<string, unknown> | unknown[] | string | number | boolean | null;

export async function registrarLog(
  acao: string,
  entidade: string,
  entidade_id: string,
  detalhes?: AuditDetails
) {
  const supabase = createSupabaseBrowserClient();
  return registrarLogComCliente(supabase, acao, entidade, entidade_id, detalhes);
}

export async function registrarLogComCliente(
  supabase: SupabaseLike,
  acao: string,
  entidade: string,
  entidade_id: string,
  detalhes?: AuditDetails
) {
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const userLabel = user.email ? `Usuario ${user.email} ` : "Usuario ";
  const alreadyHasUserEmail = user.email ? acao.startsWith(userLabel) : acao.startsWith("Usuario ");
  const acaoComUsuario = acao.startsWith("Usuario ") && !alreadyHasUserEmail ? acao.replace("Usuario ", userLabel) : acao;

  const { error } = await supabase.from("logs_auditoria").insert({
    user_email: user.email ?? "",
    user_id: user.id,
    acao: acaoComUsuario,
    entidade,
    entidade_id,
    detalhes: detalhes ?? null
  });

  if (error) {
    console.error("[EazyPost] Erro ao registrar log de auditoria:", error.message);
  }
}
