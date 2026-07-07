"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { LOTE_CAPACITY, NOME_LOTE_VENDIDOS, proximoNumeroLote } from "@/lib/lote-queue";
import { compactarLotesAction } from "@/app/actions/lotes";

type ActionResult<T> = { data: T; error?: never } | { data?: never; error: string };

type VehiclePayload = {
  nome_anuncio: string;
  quilometragem: string;
  motor: string;
  valor: number;
  cor: string;
  fipe: string;
  placa: string;
  tipo: string;
  texto_anuncio: string;
  imagens: string[];
};

// ---------------------------------------------------------------------------
// Cria o anúncio e auto-aloca em lote (cria novo lote se necessário)
// ---------------------------------------------------------------------------
export async function criarAnuncioAction(
  payload: VehiclePayload
): Promise<ActionResult<{ id: string; lote_nome: string }>> {
  const supabase = createSupabaseServerClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  // Garante que o profile existe
  await supabase.from("profiles").upsert({ id: user.id, email: user.email ?? "" });

  // 1. Insere o veículo
  const { data: newVehicle, error: insertErr } = await supabase
    .from("veiculos")
    .insert({
      user_id: user.id,
      ...payload,
      status: "pendente",
      lote_id: null,
      posicao_lote: 0
    })
    .select("id")
    .single();

  if (insertErr || !newVehicle) {
    return { error: insertErr?.message ?? "Erro ao inserir anuncio." };
  }

  const vehicleId = (newVehicle as { id: string }).id;

  // 2. Busca todos os lotes
  const { data: lotes } = await supabase
    .from("lotes")
    .select("id, nome, lote_da_vez")
    .order("created_at", { ascending: true });

  // 3. Conta veículos por lote (excluindo o recém-criado)
  const { data: veiculosComLote } = await supabase
    .from("veiculos")
    .select("lote_id")
    .not("lote_id", "is", null)
    .neq("id", vehicleId);

  const countMap = new Map<string, number>();
  for (const v of veiculosComLote ?? []) {
    const lid = (v as { lote_id: string }).lote_id;
    if (lid) countMap.set(lid, (countMap.get(lid) ?? 0) + 1);
  }

  // 4. Encontra o primeiro lote com espaço disponível
  const lotesList = (lotes ?? []) as { id: string; nome: string; lote_da_vez: boolean }[];
  let targetLote = lotesList.find((l) => (countMap.get(l.id) ?? 0) < LOTE_CAPACITY);

  // 5. Se não houver lote com espaço, cria um novo automaticamente
  if (!targetLote) {
    const nomeLote = `Lote ${proximoNumeroLote(lotesList.map((l) => l.nome))}`;
    // Primeiro lote é automaticamente marcado como "da vez"
    const ehPrimeiro = lotesList.filter((l) => l.nome !== NOME_LOTE_VENDIDOS).length === 0;

    const { data: novoLote, error: loteErr } = await supabase
      .from("lotes")
      .insert({
        user_id: user.id,
        nome: nomeLote,
        lote_da_vez: ehPrimeiro
      })
      .select("id, nome, lote_da_vez")
      .single();

    if (loteErr || !novoLote) {
      return { data: { id: vehicleId, lote_nome: "?" } };
    }

    targetLote = novoLote as { id: string; nome: string; lote_da_vez: boolean };
  }

  // 6. Busca veículos já no lote para calcular posição de inserção
  const { data: loteVehicles } = await supabase
    .from("veiculos")
    .select("id, tipo, posicao_lote")
    .eq("lote_id", targetLote.id)
    .order("posicao_lote", { ascending: true });

  const sorted = (loteVehicles ?? []) as { id: string; tipo: string; posicao_lote: number }[];

  // PRIORIDADE entra antes dos ALEATORIO; ALEATORIO vai para o final
  let insertIndex: number;
  if (payload.tipo === "prioridade") {
    const firstAleatorio = sorted.findIndex((v) => v.tipo !== "prioridade");
    insertIndex = firstAleatorio === -1 ? sorted.length : firstAleatorio;
  } else {
    insertIndex = sorted.length;
  }

  // 7. Abre espaço: incrementa posicao_lote dos que vêm depois
  const toShift = sorted.slice(insertIndex);
  for (const v of toShift) {
    await supabase
      .from("veiculos")
      .update({ posicao_lote: v.posicao_lote + 1 })
      .eq("id", v.id);
  }

  // 8. Atribui o veículo ao lote com a posição correta
  await supabase
    .from("veiculos")
    .update({ lote_id: targetLote.id, posicao_lote: insertIndex })
    .eq("id", vehicleId);

  // 9. Vincula automaticamente a todos os grupos cadastrados com id_do_grupo preenchido
  const { data: grupos } = await supabase
    .from("id_dos_grupos")
    .select("id")
    .not("id_do_grupo", "is", null);

  if (grupos && grupos.length > 0) {
    const grupoInserts = (grupos as { id: string }[]).map((grupo) => ({
      veiculo_id: vehicleId,
      grupo_id: grupo.id,
      user_id: user.id,
      programado: false
    }));
    await supabase.from("anuncio_grupos").insert(grupoInserts);
  }

  return { data: { id: vehicleId, lote_nome: targetLote.nome } };
}

// ---------------------------------------------------------------------------
// Marca veículo como vendido, move para "Lote Vendidos" e preenche
// a vaga aberta no lote original com o último veículo do lote menor.
// ---------------------------------------------------------------------------
export async function venderVeiculoAction(
  vehicleId: string
): Promise<{ error?: string }> {
  const supabase = createSupabaseServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Nao autenticado." };

  // 1. Busca o veículo
  const { data: veiculoRaw, error: getErr } = await supabase
    .from("veiculos")
    .select("id, lote_id, posicao_lote, nome_anuncio")
    .eq("id", vehicleId)
    .single();

  if (getErr || !veiculoRaw) return { error: getErr?.message ?? "Veiculo nao encontrado." };
  const veiculo = veiculoRaw as { id: string; lote_id: string | null; posicao_lote: number; nome_anuncio: string };
  const originalLoteId = veiculo.lote_id;

  // 2. Encontra ou cria o "Lote Vendidos"
  const { data: loteVendidosRaw } = await supabase
    .from("lotes")
    .select("id")
    .eq("nome", NOME_LOTE_VENDIDOS)
    .maybeSingle();

  let loteVendidosId: string;

  if (loteVendidosRaw) {
    loteVendidosId = (loteVendidosRaw as { id: string }).id;
  } else {
    const { data: novoLote, error: loteErr } = await supabase
      .from("lotes")
      .insert({ user_id: user.id, nome: NOME_LOTE_VENDIDOS, lote_da_vez: false })
      .select("id")
      .single();
    if (loteErr || !novoLote) return { error: loteErr?.message ?? "Erro ao criar Lote Vendidos." };
    loteVendidosId = (novoLote as { id: string }).id;
  }

  // 3. Move o veículo para o Lote Vendidos com status "vendido"
  const { error: moveErr } = await supabase
    .from("veiculos")
    .update({ status: "vendido", lote_id: loteVendidosId, posicao_lote: 0, updated_at: new Date().toISOString() })
    .eq("id", vehicleId);

  if (moveErr) return { error: moveErr.message };

  // Log: registra qual veículo entrou no Lote Vendidos
  await supabase.from("logs_auditoria").insert({
    user_email: user.email ?? "",
    user_id: user.id,
    acao: `Veículo [${veiculo.nome_anuncio}] foi movido para o Lote Vendidos`,
    entidade: "lote_vendidos",
    entidade_id: vehicleId,
    detalhes: {
      veiculo_id: vehicleId,
      nome_anuncio: veiculo.nome_anuncio,
      lote_anterior_id: originalLoteId,
      lote_destino: NOME_LOTE_VENDIDOS
    }
  });

  // 4. Compacta os lotes: puxa veículos dos lotes seguintes/últimos para
  // fechar a vaga aberta pela venda, sem deixar buraco no meio da sequência
  // (a sobra sempre fica concentrada no(s) último(s) lote(s)). Também
  // renumera nomes e remove lotes finais que ficaram vazios.
  if (!originalLoteId || originalLoteId === loteVendidosId) return {};

  const { error: compactErr } = await compactarLotesAction();
  if (compactErr) return { error: compactErr };

  return {};
}
