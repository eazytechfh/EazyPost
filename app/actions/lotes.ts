"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";

const LOTE_CAPACITY = 10;

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
    supabase.from("lotes").select("id, nome, lote_da_vez, created_at").neq("nome", "Vendidos"),
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

// ---------------------------------------------------------------------------
// Rebalanceia lotes: move veículos excedentes (posição > LOTE_CAPACITY) para
// lotes com espaço disponível, criando novos lotes se necessário.
// ---------------------------------------------------------------------------
export async function rebalancearLotesAction(): Promise<{
  lotesAfetados: number;
  veiculosMigrados: number;
  novosLotesCriados: number;
  error?: string;
}> {
  const supabase = createSupabaseServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { lotesAfetados: 0, veiculosMigrados: 0, novosLotesCriados: 0, error: "Não autenticado." };

  // 1. Busca todos os lotes exceto Vendidos, em ordem de criação
  const { data: lotesRaw, error: lotesErr } = await supabase
    .from("lotes")
    .select("id, nome")
    .neq("nome", "Vendidos")
    .order("created_at", { ascending: true });

  if (lotesErr) return { lotesAfetados: 0, veiculosMigrados: 0, novosLotesCriados: 0, error: lotesErr.message };

  const lotes = (lotesRaw ?? []) as { id: string; nome: string }[];
  if (lotes.length === 0) return { lotesAfetados: 0, veiculosMigrados: 0, novosLotesCriados: 0 };

  // 2. Busca todos os veículos não-vendidos desses lotes, ordenados por posição
  const { data: veiculosRaw } = await supabase
    .from("veiculos")
    .select("id, lote_id, posicao_lote")
    .not("lote_id", "is", null)
    .neq("status", "vendido")
    .in("lote_id", lotes.map((l) => l.id))
    .order("posicao_lote", { ascending: true });

  const veiculos = (veiculosRaw ?? []) as { id: string; lote_id: string; posicao_lote: number }[];

  // 3. Agrupa veículos por lote mantendo a ordem
  const porLote = new Map<string, { id: string; lote_id: string; posicao_lote: number }[]>();
  for (const lote of lotes) porLote.set(lote.id, []);
  for (const v of veiculos) {
    const arr = porLote.get(v.lote_id);
    if (arr) arr.push(v);
  }

  // 4. Identifica excedentes (veículos além do LOTE_CAPACITY em cada lote)
  const excedentes: { id: string; lote_id: string }[] = [];
  const lotesComExcesso = new Set<string>();

  for (const lote of lotes) {
    const arr = porLote.get(lote.id) ?? [];
    if (arr.length > LOTE_CAPACITY) {
      excedentes.push(...arr.slice(LOTE_CAPACITY).map((v) => ({ id: v.id, lote_id: v.lote_id })));
      lotesComExcesso.add(lote.id);
    }
  }

  if (excedentes.length === 0) return { lotesAfetados: 0, veiculosMigrados: 0, novosLotesCriados: 0 };

  // 5. Contagem in-memory por lote (apenas os que ficam, descontando excedentes)
  const contagens = new Map<string, number>();
  for (const lote of lotes) {
    const arr = porLote.get(lote.id) ?? [];
    contagens.set(lote.id, Math.min(arr.length, LOTE_CAPACITY));
  }

  let novosLotesCriados = 0;
  let veiculosMigrados = 0;
  const lotesDestinoNovos: { id: string; nome: string }[] = [];

  // 6. Realoca cada excedente para o primeiro lote com espaço (ou cria novo)
  for (const exc of excedentes) {
    let destino: { id: string; nome: string } | null = null;

    for (const lote of [...lotes, ...lotesDestinoNovos]) {
      if (lote.id === exc.lote_id) continue;
      if ((contagens.get(lote.id) ?? 0) < LOTE_CAPACITY) {
        destino = lote;
        break;
      }
    }

    // Nenhum lote disponível — cria um novo
    if (!destino) {
      const totalAtual = lotes.length + lotesDestinoNovos.length;
      const nomeLote = `Lote ${totalAtual + 1}`;
      const { data: novoLote, error: loteErr } = await supabase
        .from("lotes")
        .insert({ user_id: user.id, nome: nomeLote, lote_da_vez: false })
        .select("id, nome")
        .single();

      if (loteErr || !novoLote) continue;

      const nl = novoLote as { id: string; nome: string };
      lotesDestinoNovos.push(nl);
      contagens.set(nl.id, 0);
      novosLotesCriados++;
      destino = nl;
    }

    const novaPosicao = (contagens.get(destino.id) ?? 0) + 1;

    const { error: moveErr } = await supabase
      .from("veiculos")
      .update({ lote_id: destino.id, posicao_lote: novaPosicao })
      .eq("id", exc.id);

    if (!moveErr) {
      contagens.set(destino.id, novaPosicao);
      veiculosMigrados++;
    }
  }

  // 7. Renumera posições nos lotes de origem para fechar as lacunas
  for (const loteId of Array.from(lotesComExcesso)) {
    const { data: restantes } = await supabase
      .from("veiculos")
      .select("id")
      .eq("lote_id", loteId)
      .neq("status", "vendido")
      .order("posicao_lote", { ascending: true });

    if (!restantes) continue;

    await Promise.all(
      (restantes as { id: string }[]).map((v, idx) =>
        supabase.from("veiculos").update({ posicao_lote: idx + 1 }).eq("id", v.id)
      )
    );
  }

  // 8. Log
  await registrarLogSistema(
    `Rebalanceamento de lotes: ${veiculosMigrados} veículo${veiculosMigrados !== 1 ? "s" : ""} redistribuído${veiculosMigrados !== 1 ? "s" : ""} de ${lotesComExcesso.size} lote${lotesComExcesso.size !== 1 ? "s" : ""}`,
    {
      acao: "rebalanceamento_lotes",
      lotes_com_excesso: lotesComExcesso.size,
      veiculos_migrados: veiculosMigrados,
      novos_lotes_criados: novosLotesCriados
    }
  );

  return { lotesAfetados: lotesComExcesso.size, veiculosMigrados, novosLotesCriados };
}
