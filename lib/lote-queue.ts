// ---------------------------------------------------------------------------
// Utilitários compartilhados de numeração e ordenação de lotes.
// Usado tanto em server actions/rotas quanto em componentes client, por isso
// não tem diretiva "use server"/"use client" — é um módulo puro.
// ---------------------------------------------------------------------------

export const NOME_LOTE_VENDIDOS = "Vendidos";

// Extrai o número de "Lote 12" -> 12. Retorna +Infinity se não achar número
// (evita que nomes fora do padrão quebrem a ordenação, jogando-os pro final).
export function extrairNumeroLote(nome: string): number {
  const match = nome.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
}

// Ordena lotes pela sequência numérica do nome (1, 2, 3, ...). Em caso de
// empate (nomes duplicados/sem número), desempata por created_at ascendente.
export function ordenarLotesPorNumero<
  T extends { nome: string; created_at?: string | null }
>(lotes: T[]): T[] {
  return [...lotes].sort((a, b) => {
    const na = extrairNumeroLote(a.nome);
    const nb = extrairNumeroLote(b.nome);
    if (na !== nb) return na - nb;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

// Seleciona o próximo lote elegível (com veículos ativos) em ordem
// sequencial estrita e circular, a partir do lote atualmente marcado como
// "da vez". Se nenhum lote estiver marcado, começa pelo primeiro elegível.
export function selecionarProximoLoteSequencial<
  T extends { id: string; lote_da_vez?: boolean }
>(lotesOrdenados: T[], ativosPorId: Map<string, number>): T | null {
  if (lotesOrdenados.length === 0) return null;

  const temAtivos = (l: T) => (ativosPorId.get(l.id) ?? 0) > 0;
  const idxAtual = lotesOrdenados.findIndex((l) => l.lote_da_vez);

  // Nenhum lote marcado ainda: começa do primeiro elegível na sequência.
  if (idxAtual === -1) {
    return lotesOrdenados.find(temAtivos) ?? null;
  }

  // Procura, em ordem circular a partir da posição seguinte, o próximo
  // lote com veículos ativos — incluindo voltar ao próprio lote atual
  // (caso ele ainda seja o único elegível no ciclo).
  for (let step = 1; step <= lotesOrdenados.length; step++) {
    const candidato = lotesOrdenados[(idxAtual + step) % lotesOrdenados.length];
    if (temAtivos(candidato)) return candidato;
  }

  return null;
}

// Verificação diária (rodada uma vez, no horário de checkpoint — ex: 19h):
// decide se o ciclo deve ser resetado, complementado ou apenas seguir em frente.
//
// - reseta: não sobrou nenhum lote com veículo ativo -> todo o ciclo volta
//   ("enviado" -> "ativo") para recomeçar do zero.
// - complementa: sobraram lotes ativos, mas em quantidade menor que o total
//   de horários de disparo do dia -> completa a fila trazendo de volta
//   ("enviado" -> "ativo") os próximos lotes esgotados na ordem sequencial
//   circular, a partir do lote atual, até fechar a quantidade de horários.
// - prossegue: já existem lotes ativos suficientes para preencher todos os
//   horários do dia -> nada muda.
export type VerificacaoDiariaResultado =
  | { tipo: "reseta" }
  | { tipo: "complementa"; loteIds: string[] }
  | { tipo: "prossegue" }
  | { tipo: "nada" };

export function calcularVerificacaoDiaria<
  T extends { id: string; nome: string; lote_da_vez?: boolean }
>(
  lotesOrdenados: T[],
  ativosPorId: Map<string, number>,
  enviadosPorId: Map<string, number>,
  totalHorariosPermitidos: number
): VerificacaoDiariaResultado {
  const temAtivos = (l: T) => (ativosPorId.get(l.id) ?? 0) > 0;
  const temEnviados = (l: T) => (enviadosPorId.get(l.id) ?? 0) > 0;

  const lotesAtivos = lotesOrdenados.filter(temAtivos);
  const totalEnviados = lotesOrdenados.reduce((acc, l) => acc + (enviadosPorId.get(l.id) ?? 0), 0);

  // Nenhum lote ativo: reseta o ciclo inteiro, se houver algo para resetar.
  if (lotesAtivos.length === 0) {
    return totalEnviados > 0 ? { tipo: "reseta" } : { tipo: "nada" };
  }

  // Já há lotes ativos suficientes para cobrir todos os horários do dia.
  if (lotesAtivos.length >= totalHorariosPermitidos) {
    return { tipo: "prossegue" };
  }

  // Faltam lotes: complementa trazendo de volta os próximos esgotados,
  // em ordem circular a partir do lote atual ("lote_da_vez"), sem repetir.
  const faltam = totalHorariosPermitidos - lotesAtivos.length;
  const idxAtual = lotesOrdenados.findIndex((l) => l.lote_da_vez);
  const inicio = idxAtual === -1 ? 0 : idxAtual + 1;

  const loteIds: string[] = [];
  for (let step = 0; step < lotesOrdenados.length && loteIds.length < faltam; step++) {
    const candidato = lotesOrdenados[(inicio + step) % lotesOrdenados.length];
    if (!temAtivos(candidato) && temEnviados(candidato)) {
      loteIds.push(candidato.id);
    }
  }

  return loteIds.length > 0 ? { tipo: "complementa", loteIds } : { tipo: "prossegue" };
}

// Status do "próximo disparo" para exibição no countdown do dashboard.
// Regra: só existe contagem regressiva na hora imediatamente anterior a um
// horário permitido (ex: 08h conta pra 09h, 12h conta pra 13h). Fora disso
// (incluindo horas bloqueadas fora da janela de 1h, e a própria hora do
// disparo em diante) mostra apenas o próximo horário permitido, parado.
export type StatusDisparo =
  | { modo: "contagem"; proximaHora: number; segundosRestantes: number }
  | { modo: "aguardando"; proximaHora: number };

// America/Sao_Paulo é UTC-3 fixo (sem horário de verão desde 2019),
// por isso dá pra calcular o instante UTC alvo sem lib de timezone.
const OFFSET_SAO_PAULO_MS = 3 * 60 * 60 * 1000;

export function calcularStatusDisparo(horasPermitidas: number[], agora: Date): StatusDisparo {
  const sorted = [...horasPermitidas].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b);
  if (sorted.length === 0) return { modo: "aguardando", proximaHora: 9 };

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(agora);

  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  const ano = get("year");
  const mes = get("month");
  const dia = get("day");
  const horaAtual = get("hour") % 24; // "24" vira "00" em alguns runtimes

  const proximaHora = sorted.find((h) => h > horaAtual) ?? sorted[0];
  const avancaDia = proximaHora <= horaAtual;

  const preHora = (proximaHora - 1 + 24) % 24;
  if (horaAtual !== preHora) {
    return { modo: "aguardando", proximaHora };
  }

  const meiaNoiteSaoPauloUtcMs = Date.UTC(ano, mes - 1, dia, 0, 0, 0) + OFFSET_SAO_PAULO_MS;
  const alvoUtcMs =
    meiaNoiteSaoPauloUtcMs + (avancaDia ? 24 * 60 * 60 * 1000 : 0) + proximaHora * 60 * 60 * 1000;

  const segundosRestantes = Math.max(0, Math.round((alvoUtcMs - agora.getTime()) / 1000));

  return { modo: "contagem", proximaHora, segundosRestantes };
}

// Calcula o próximo número de lote a criar, com base no maior número já
// existente entre os lotes reais (nunca conta o lote pseudo "Vendidos" e
// nunca soma contagens — evita os saltos causados por COUNT(*) inconsistente).
export function proximoNumeroLote(nomesExistentes: string[]): number {
  const numeros = nomesExistentes
    .filter((n) => n !== NOME_LOTE_VENDIDOS)
    .map(extrairNumeroLote)
    .filter((n) => Number.isFinite(n));

  return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
}
