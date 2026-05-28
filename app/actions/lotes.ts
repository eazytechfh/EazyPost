"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Registra um log gerado automaticamente pelo sistema (sem sessão de usuário)
// ---------------------------------------------------------------------------
async function registrarLogSistema(
  acao: string,
  detalhes: Record<string, unknown>
) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("logs_auditoria").insert({
    user_email: "sistema",
    user_id: null,
    acao,
    entidade: "disparo_automatico",
    entidade_id: null,
    detalhes: {
      ...detalhes,
      executado_em: new Date().toISOString()
    }
  });
  if (error) {
    console.error("[EazyPost] Erro ao registrar log do sistema:", error.message);
  }
}

export type LoteProgramacao = {
  id: string;
  nome: string;
  lote_da_vez: boolean;
  total_veiculos: number;
  veiculos_ativos: number;
  created_at: string;
  posicao: number; // posição na fila (1 = próximo a disparar)
};

// ---------------------------------------------------------------------------
// Retorna lotes ordenados pela fila de disparo:
// 1º critério: veículos ativos DESC
// 2º critério: total de veículos DESC
// ---------------------------------------------------------------------------
export async function getProgramacaoAction(): Promise<{
  data: LoteProgramacao[];
  error?: string;
}> {
  const supabase = createSupabaseServerClient();

  const [lotesResult, allVehiclesResult, activeVehiclesResult] = await Promise.all([
    supabase.from("lotes").select("id, nome, lote_da_vez, created_at"),
    supabase.from("veiculos").select("lote_id").not("lote_id", "is", null),
    supabase
      .from("veiculos")
      .select("lote_id")
      .not("lote_id", "is", null)
      .eq("status", "ativo")
  ]);

  if (lotesResult.error) return { data: [], error: lotesResult.error.message };

  // Conta por lote
  const totalMap = new Map<string, number>();
  const activeMap = new Map<string, number>();

  for (const v of allVehiclesResult.data ?? []) {
    const lid = (v as { lote_id: string }).lote_id;
    totalMap.set(lid, (totalMap.get(lid) ?? 0) + 1);
  }
  for (const v of activeVehiclesResult.data ?? []) {
    const lid = (v as { lote_id: string }).lote_id;
    activeMap.set(lid, (activeMap.get(lid) ?? 0) + 1);
  }

  const list = (lotesResult.data ?? []).map((lote) => ({
    id: lote.id,
    nome: lote.nome as string,
    lote_da_vez: lote.lote_da_vez as boolean,
    total_veiculos: totalMap.get(lote.id) ?? 0,
    veiculos_ativos: activeMap.get(lote.id) ?? 0,
    created_at: lote.created_at as string,
    posicao: 0
  }));

  // Ordenação: ativos DESC → total DESC → criação ASC
  list.sort((a, b) => {
    if (b.veiculos_ativos !== a.veiculos_ativos) return b.veiculos_ativos - a.veiculos_ativos;
    if (b.total_veiculos !== a.total_veiculos) return b.total_veiculos - a.total_veiculos;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Atribui posição
  list.forEach((l, i) => { l.posicao = i + 1; });

  return { data: list };
}

// ---------------------------------------------------------------------------
// Sincroniza o flag lote_da_vez no banco para o topo da fila ordenada
// (maior volume de veículos ativos). Chamado ao montar a página Programação.
// ---------------------------------------------------------------------------
export async function sincronizarFilaAction(): Promise<{ error?: string }> {
  const supabase = createSupabaseServerClient();

  const { data: programacao, error } = await getProgramacaoAction();
  if (error) return { error };

  const elegíveis = programacao.filter((l) => l.veiculos_ativos > 0);

  // Limpa todos os flags
  await supabase
    .from("lotes")
    .update({ lote_da_vez: false })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  // Marca o topo da fila (mais ativos) como lote_da_vez
  if (elegíveis.length > 0) {
    await supabase
      .from("lotes")
      .update({ lote_da_vez: true })
      .eq("id", elegíveis[0].id);
  }

  return {};
}

// ---------------------------------------------------------------------------
// Dispara o lote no topo da fila ordenada (maior volume de ativos).
// Retorna o lote que foi disparado (para payload do webhook).
// ---------------------------------------------------------------------------
export async function avancarLoteDaVezAction(): Promise<{
  loteFoiDisparado: { id: string; nome: string } | null;
  error?: string;
}> {
  const supabase = createSupabaseServerClient();

  const { data: programacao, error } = await getProgramacaoAction();
  if (error || !programacao.length) return { loteFoiDisparado: null, error };

  // Lotes com pelo menos 1 veículo ativo (já ordenados por ativos DESC)
  const elegíveis = programacao.filter((l) => l.veiculos_ativos > 0);

  if (!elegíveis.length) {
    // Nenhum lote ativo — verifica se há veículos "enviado" para reiniciar o ciclo
    const { count: enviadosCount } = await supabase
      .from("veiculos")
      .select("id", { count: "exact", head: true })
      .eq("status", "enviado");

    if (enviadosCount && enviadosCount > 0) {
      // Ciclo completo: reseta todos "enviado" → "ativo"
      await supabase
        .from("veiculos")
        .update({ status: "ativo", updated_at: new Date().toISOString() })
        .eq("status", "enviado");

      await registrarLogSistema(
        `Sistema resetou o ciclo — ${enviadosCount} veículo${enviadosCount !== 1 ? "s" : ""} voltaram de "enviado" para "ativo"`,
        { acao: "ciclo_resetado", veiculos_resetados: enviadosCount }
      );
    } else {
      // Sem ativos e sem enviados — nenhuma ação possível
      await registrarLogSistema(
        "Sistema verificou a fila mas não há veículos para disparar",
        { acao: "sem_veiculos" }
      );
    }

    return { loteFoiDisparado: null };
  }

  // O topo da fila (posição 1 = mais ativos) é quem dispara agora
  const loteDisparado = elegíveis[0];

  // Limpa todos os flags
  await supabase
    .from("lotes")
    .update({ lote_da_vez: false })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  // Mantém o topo como lote_da_vez (próximo disparo = quem tiver mais ativos)
  const { error: setErr } = await supabase
    .from("lotes")
    .update({ lote_da_vez: true })
    .eq("id", loteDisparado.id);

  if (setErr) return { loteFoiDisparado: { id: loteDisparado.id, nome: loteDisparado.nome }, error: setErr.message };

  await registrarLogSistema(
    `Sistema disparou o webhook para o lote "${loteDisparado.nome}" (${loteDisparado.veiculos_ativos} veículo${loteDisparado.veiculos_ativos !== 1 ? "s" : ""} ativo${loteDisparado.veiculos_ativos !== 1 ? "s" : ""})`,
    {
      acao: "webhook_disparado",
      lote_id: loteDisparado.id,
      lote_nome: loteDisparado.nome,
      veiculos_ativos: loteDisparado.veiculos_ativos
    }
  );

  return {
    loteFoiDisparado: { id: loteDisparado.id, nome: loteDisparado.nome }
  };
}
