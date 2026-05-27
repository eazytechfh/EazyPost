"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";

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
// Avança a fila: marca o lote atual como false e o próximo como true.
// Retorna o lote que acabou de disparar (para payload do webhook).
// ---------------------------------------------------------------------------
export async function avancarLoteDaVezAction(): Promise<{
  loteFoiDisparado: { id: string; nome: string } | null;
  error?: string;
}> {
  const supabase = createSupabaseServerClient();

  const { data: programacao, error } = await getProgramacaoAction();
  if (error || !programacao.length) return { loteFoiDisparado: null, error };

  // Lotes com pelo menos 1 veículo ativo
  const elegíveis = programacao.filter((l) => l.veiculos_ativos > 0);
  if (!elegíveis.length) {
    // Nenhum lote elegível — apenas registra
    return { loteFoiDisparado: null };
  }

  // Qual está marcado agora?
  const currentIdx = elegíveis.findIndex((l) => l.lote_da_vez);
  const currentLote = currentIdx >= 0 ? elegíveis[currentIdx] : null;

  // Próximo (circular dentro dos elegíveis)
  const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % elegíveis.length;
  const nextLote = elegíveis[nextIdx];

  // Limpa todos os lotes
  await supabase
    .from("lotes")
    .update({ lote_da_vez: false })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  // Marca o próximo
  const { error: setErr } = await supabase
    .from("lotes")
    .update({ lote_da_vez: true })
    .eq("id", nextLote.id);

  if (setErr) return { loteFoiDisparado: currentLote, error: setErr.message };

  return {
    loteFoiDisparado: currentLote
      ? { id: currentLote.id, nome: currentLote.nome }
      : null
  };
}
