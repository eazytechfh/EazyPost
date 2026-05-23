import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { LogAuditoria } from "@/types/database";

type LogsPageProps = {
  searchParams?: {
    data?: string;
    usuario?: string;
  };
};

export default async function LogsPage({ searchParams }: LogsPageProps) {
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

  if (!profile?.is_admin) redirect("/dashboard/anuncio");

  const selectedDate = searchParams?.data?.trim() ?? "";
  const selectedUser = searchParams?.usuario?.trim() ?? "";

  let query = supabase
    .from("logs_auditoria")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (selectedDate) {
    const start = new Date(`${selectedDate}T00:00:00.000-03:00`);
    const end = new Date(`${selectedDate}T23:59:59.999-03:00`);

    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      query = query.gte("created_at", start.toISOString()).lte("created_at", end.toISOString());
    }
  }

  if (selectedUser) {
    query = query.ilike("user_email", `%${selectedUser}%`);
  }

  const { data: logs, error } = await query;
  const rows = (logs ?? []) as LogAuditoria[];

  return (
    <section>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-app-green">
            <ClipboardList size={14} />
            Auditoria
          </p>
          <h1 className="text-2xl font-bold text-app-white">Logs</h1>
          <p className="mt-1 text-sm text-app-muted">Acompanhe criacoes, edicoes, exclusoes e atualizacoes feitas no sistema.</p>
        </div>
      </div>

      <form className="app-card mb-5 grid gap-4 p-4 md:grid-cols-[220px_1fr_auto] md:items-end">
        <label className="space-y-2">
          <span className="app-label">Data</span>
          <input className="app-input" type="date" name="data" defaultValue={selectedDate} />
        </label>
        <label className="space-y-2">
          <span className="app-label">Usuario</span>
          <input className="app-input" name="usuario" defaultValue={selectedUser} placeholder="email@empresa.com" />
        </label>
        <button className="app-button" type="submit">
          Filtrar
        </button>
      </form>

      {error ? (
        <div className="app-card p-6 text-sm text-red-400">{error.message}</div>
      ) : rows.length === 0 ? (
        <div className="app-card p-6 text-sm text-app-muted">Nenhum log encontrado.</div>
      ) : (
        <div className="app-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-app-border bg-app-panel text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-app-muted">Data/Hora</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-app-muted">Usuario</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-app-muted">Acao</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-app-muted">Entidade</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-app-muted">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  <tr key={log.id} className="border-b border-app-border last:border-0 hover:bg-app-card/40">
                    <td className="whitespace-nowrap px-4 py-3 text-app-muted">{formatDateTime(log.created_at)}</td>
                    <td className="px-4 py-3 font-medium text-app-white">{log.user_email || "-"}</td>
                    <td className="px-4 py-3 text-app-white">{log.acao}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-app-border bg-app-panel px-2 py-1 text-xs font-semibold text-app-muted">
                        {log.entidade}
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-3 text-xs text-app-muted">
                      <pre className="whitespace-pre-wrap break-words font-mono">{formatDetails(log.detalhes)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDetails(value: LogAuditoria["detalhes"]) {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}
