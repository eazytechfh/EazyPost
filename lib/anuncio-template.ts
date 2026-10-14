import { parseCurrencyInput } from "@/lib/format";

export type AnuncioTemplateFields = {
  nome_anuncio: string;
  fipe: string;
  valor: string;
  ano: string;
  quilometragem: string;
  placa: string;
  cambio: string;
  local: string;
  pericia_aprova: boolean;
  pericia_motivo: string;
  leilao: boolean;
  sinistro: boolean;
  valor_promocional_ativo: boolean;
  valor_promocional: string;
  empresa: string;
};

export function buildAnuncioTemplate(fields: AnuncioTemplateFields) {
  const nome = fields.nome_anuncio || "[Nome do Anúncio]";
  const fipe = fields.fipe || "[FIPE]";
  const valorNum = parseCurrencyInput(fields.valor);
  const valorDisplay = fields.valor
    ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(valorNum)
    : "[Valor]";
  const ano = fields.ano || "[ANO]";
  const km = fields.quilometragem || "[KM]";
  const placa = fields.placa ? fields.placa.toUpperCase() : "[PLACA]";
  const cambio = fields.cambio || "[CÂMBIO]";
  const local = fields.local || "[LOCAL]";
  const pericia = fields.pericia_aprova
    ? "APROVA ✅"
    : `NÃO APROVA ❌${fields.pericia_motivo ? ` - ${fields.pericia_motivo}` : ""}`;
  const leilaoLinha = `${fields.leilao ? "COM LEILÃO" : "SEM LEILÃO"} | ${fields.sinistro ? "COM SINISTRO ❌" : "SEM SINISTRO ✅"}`;
  const formatBRL = (v: string) =>
    new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(parseCurrencyInput(v));
  const promoAtiva = fields.valor_promocional_ativo && !!fields.valor_promocional;
  const valorLinha = promoAtiva ? `💰 VALOR: ~${valorDisplay}~` : `💰 VALOR: ${valorDisplay}`;
  const promoBloco = promoAtiva ? `

⚠️ VALOR R$ ${formatBRL(fields.valor_promocional)} ⚠️` : "";
  const empresa = fields.empresa ? ` / ${fields.empresa}` : "";

  return `${nome}

💸 FIPE: ~${fipe}~
${valorLinha}${promoBloco}

ANO: ${ano} | KM: ${km}
CÂMBIO: ${cambio}
PERÍCIA: ${pericia}
PLACA: ${placa}

${leilaoLinha}

PAGAMENTO NO CARTÃO DE CRÉDITO EM ATÉ 24X, FINANCIAMENTO EM TODOS OS BANCOS, SEM ENTRADA, SUJEITO À ANÁLISE DE CRÉDITO. CONSULTE NOSSOS VENDEDORES

VEÍCULOS PARA FORA DO ESTADO DO PARANÁ: ADICIONAL DE 1% DO VALOR DA VENDA PARA NF

📍 ${local}${empresa}

🏢 Endereço: Rua Miguel José Grein, 38 – Xaxim, Curitiba/PR.

📲 WhatsApp de Compras: (41) 99157-2733`;
}

/** Extrai do texto já gerado os campos que não têm coluna própria no banco. */
export function parseAnuncioTexto(texto: string, local: string) {
  const ano = texto.match(/^ANO:\s*(.*?)\s*\|/m)?.[1] ?? "";
  const cambio = texto.match(/^CÂMBIO:\s*(.*)$/m)?.[1]?.trim() ?? "";
  const sinistro = /^(COM|SEM) LEILÃO\s*\|\s*COM SINISTRO/m.test(texto);
  const promo = texto.match(/^⚠️ VALOR R\$\s*([\d.]+)/m)?.[1];
  const localLine = texto.match(/^📍\s*(.*)$/m)?.[1]?.trim() ?? "";
  const empresa = localLine.startsWith(local.trim()) ? localLine.slice(local.trim().length).replace(/^\s*\/\s*/, "") : "";
  return {
    ano,
    cambio,
    sinistro,
    valor_promocional_ativo: Boolean(promo),
    valor_promocional: promo ? promo.replace(/\./g, "") : "",
    empresa
  };
}
