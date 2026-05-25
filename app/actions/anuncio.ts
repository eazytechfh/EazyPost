"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";

type ActionResult<T> = { data: T; error?: never } | { data?: never; error: string };

const LOTE_CAPACITY = 16;

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
    const totalLotes = lotesList.length;
    const nomeLote = `Lote ${totalLotes + 1}`;
    // Primeiro lote é automaticamente marcado como "da vez"
    const ehPrimeiro = totalLotes === 0;

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

  return { data: { id: vehicleId, lote_nome: targetLote.nome } };
}
