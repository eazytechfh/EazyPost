import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AdminUsuarios } from "@/components/admin-usuarios";

export default async function AdminPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  // Apenas admins acessam esta página
  if (!profile?.is_admin) redirect("/dashboard/anuncio");

  return <AdminUsuarios />;
}
