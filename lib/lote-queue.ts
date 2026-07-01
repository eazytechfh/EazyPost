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
