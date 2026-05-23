"use server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";

type ActionResult<T> = { data: T; error?: never } | { data?: never; error: string };

// Garante que o usuário chamador é admin
async function requireAdmin() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Nao autenticado.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) throw new Error("Acesso negado. Apenas administradores.");

  return user;
}

// --------------------------------------------------------------------------
// Listar todos os usuários
// --------------------------------------------------------------------------
export async function listUsersAction(): Promise<
  ActionResult<{ id: string; email: string; created_at: string; is_admin: boolean }[]>
> {
  try {
    await requireAdmin();
  } catch (err) {
    return { error: (err as Error).message };
  }

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000, page: 1 });
  if (error || !data) return { error: error?.message ?? "Erro ao listar usuarios." };

  // Busca flags de admin da tabela profiles (service role bypassa RLS)
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, is_admin");

  const adminMap = new Map<string, boolean>(
    ((profiles ?? []) as { id: string; is_admin: boolean }[]).map((p) => [p.id, p.is_admin ?? false])
  );

  return {
    data: data.users
      .map((u) => ({
        id: u.id,
        email: u.email ?? "",
        created_at: u.created_at ?? new Date().toISOString(),
        is_admin: adminMap.get(u.id) ?? false
      }))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  };
}

// --------------------------------------------------------------------------
// Criar novo usuário
// --------------------------------------------------------------------------
export async function createUserAction(
  email: string,
  password: string
): Promise<ActionResult<{ id: string; email: string }>> {
  try {
    await requireAdmin();
  } catch (err) {
    return { error: (err as Error).message };
  }

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true // usuário já pode logar sem verificar email
  });

  if (error || !data.user) return { error: error?.message ?? "Erro ao criar usuario." };

  return { data: { id: data.user.id, email: data.user.email ?? email } };
}

// --------------------------------------------------------------------------
// Remover usuário
// --------------------------------------------------------------------------
export async function deleteUserAction(userId: string): Promise<ActionResult<boolean>> {
  let caller;
  try {
    caller = await requireAdmin();
  } catch (err) {
    return { error: (err as Error).message };
  }

  if (caller.id === userId) {
    return { error: "Voce nao pode remover sua propria conta." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };

  return { data: true };
}

// --------------------------------------------------------------------------
// Tornar / remover admin
// --------------------------------------------------------------------------
export async function toggleAdminAction(
  userId: string,
  makeAdmin: boolean
): Promise<ActionResult<boolean>> {
  let caller;
  try {
    caller = await requireAdmin();
  } catch (err) {
    return { error: (err as Error).message };
  }

  if (caller.id === userId) {
    return { error: "Voce nao pode alterar sua propria permissao de admin." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_admin: makeAdmin })
    .eq("id", userId);

  if (error) return { error: error.message };
  return { data: true };
}
