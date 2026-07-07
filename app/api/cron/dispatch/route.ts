import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase-server";
import {
  NOME_LOTE_VENDIDOS,
  ordenarLotesPorNumero,
  selecionarProximoLoteSequencial
} from "@/lib/lote-queue";

// Garante que a rota nunca seja cacheada pela Vercel
export const dynamic = "force-dynamic";
export const revalidate = 0;

const WEBHOOK_URL = "https://n8n.eazy.tec.br/webhook/4b4ea55a-7916-4592-b44c-875fc13d7064";
const TOTAL_SECONDS = 60 * 60;
const RETRY_DELAYS = [0, 3000, 7000, 15000];

// ---------------------------------------------------------------------------
// Dispara webhook com retry — body sempre inclui lote_id e lote_nome
// ---------------------------------------------------------------------------
async function tryFireWebhook(lote: { id: string; nome: string }): Promise<boolean> {
  const body = { disparar: "ok", lote_id: lote.id, lote_nome: lote.nome };

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (RETRY_DELAYS[attempt] > 0) {
      await new Promise<void>((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        console.info(`[EazyPost Cron] Webhook disparado — lote: ${lote.nome} (tentativa ${attempt + 1})`);
        return true;
      }
      console.warn(`[EazyPost Cron] HTTP ${res.status} — tentativa ${attempt + 1}/${RETRY_DELAYS.length}`);
    } catch (err) {
      console.warn(`[EazyPost Cron] Erro — tentativa ${attempt + 1}/${RETRY_DELAYS.length}:`, err);
    }
  }
  console.error("[EazyPost Cron] Webhook falhou após todas as tentativas.");
  return false;
}

// ---------------------------------------------------------------------------
// GET /api/cron/dispatch
// Chamado a cada 5 min pelo n8n ou serviço externo.
// Usa service role — não depende de sessão de usuário.
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  // Rota chamada exclusivamente pelo Vercel Cron (a cada 1 min) e pelo n8n.
  // Vercel injeta automaticamente o header Authorization com CRON_SECRET.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Sem disparo aos domingos (horário de Brasília — America/Sao_Paulo, UTC-3, sem DST)
  const diaSemana = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(new Date());

  if (diaSemana === "Sun") {
    return NextResponse.json({ ok: false, reason: "sunday_skip" });
  }

  // Service role: ignora RLS, não precisa de sessão/login
  const supabase = createSupabaseServiceClient();

  // 1. Lê o próximo disparo agendado e os horários permitidos (configurável em /dashboard/admin)
  const { data: configRaw, error: configError } = await supabase
    .from("dispatch_config")
    .select("next_dispatch_at, horas_permitidas")
    .eq("id", 1)
    .maybeSingle();

  console.log("[dispatch] configRaw:", configRaw, "error:", configError);

  const horasPermitidas = (configRaw as { horas_permitidas: number[] } | null)?.horas_permitidas
    ?? [9, 10, 13, 14, 15, 16, 17];

  const horaAtual = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hourCycle: "h23"
    }).format(new Date()),
    10
  );

  if (!horasPermitidas.includes(horaAtual)) {
    return NextResponse.json({ ok: false, reason: "outside_allowed_hours", hora_atual: horaAtual, horas_permitidas: horasPermitidas });
  }

  const currentIso = (configRaw as { next_dispatch_at: string } | null)?.next_dispatch_at ?? null;
  const nextAt = currentIso ? new Date(currentIso).getTime() : 0;
  const now = Date.now();

  console.log("[dispatch] currentIso:", currentIso, "nextAt:", new Date(nextAt).toISOString(), "now:", new Date(now).toISOString(), "diff_sec:", Math.round((nextAt - now) / 1000));

  // 2. Ainda não é hora de disparar
  if (nextAt > now) {
    const remainingSec = Math.round((nextAt - now) / 1000);
    console.log("[dispatch] not_yet — remaining:", remainingSec, "s");
    return NextResponse.json({ ok: false, reason: "not_yet", remaining_seconds: remainingSec, next_dispatch_at: currentIso });
  }

  // 3. Claim atômico: só prossegue quem atualizar o banco primeiro
  const newNextIso = new Date(now + TOTAL_SECONDS * 1000).toISOString();
  console.log("[dispatch] claiming — newNextIso:", newNextIso);

  if (currentIso) {
    const { data: claimed, error: claimError } = await supabase
      .from("dispatch_config")
      .update({ next_dispatch_at: newNextIso })
      .eq("id", 1)
      .eq("next_dispatch_at", currentIso)
      .select("id");

    console.log("[dispatch] claim result:", claimed, "error:", claimError);

    if (!claimed || claimed.length === 0) {
      console.log("[dispatch] already_claimed — outro processo ganhou");
      return NextResponse.json({ ok: false, reason: "already_claimed", next_dispatch_at: newNextIso });
    }
  } else {
    console.log("[dispatch] currentIso é null — inserindo diretamente");
    const { error: insertError } = await supabase
      .from("dispatch_config")
      .update({ next_dispatch_at: newNextIso })
      .eq("id", 1);
    console.log("[dispatch] insert error:", insertError);
  }

  // 4. Busca a fila de lotes na sequência numérica (Lote 1, 2, 3, ...) e
  // avança em ordem circular a partir do último lote disparado (lote_da_vez).
  const [lotesResult, ativosResult] = await Promise.all([
    supabase.from("lotes").select("id, nome, lote_da_vez, created_at").neq("nome", NOME_LOTE_VENDIDOS),
    supabase.from("veiculos").select("lote_id").eq("status", "ativo").not("lote_id", "is", null)
  ]);

  const lotes = (lotesResult.data ?? []) as { id: string; nome: string; lote_da_vez: boolean; created_at: string }[];
  const ativosMap = new Map<string, number>();

  (ativosResult.data ?? []).forEach((v) => {
    const lid = (v as { lote_id: string }).lote_id;
    ativosMap.set(lid, (ativosMap.get(lid) ?? 0) + 1);
  });

  // Ordena pela sequência numérica do nome do lote (1, 2, 3, ...)
  const sorted = ordenarLotesPorNumero(lotes);

  const proximo = selecionarProximoLoteSequencial(sorted, ativosMap);

  // 5. Sem lotes ativos — verifica reset de ciclo
  if (!proximo) {
    const { count: enviadosCount } = await supabase
      .from("veiculos")
      .select("id", { count: "exact", head: true })
      .eq("status", "enviado");

    if (enviadosCount && enviadosCount > 0) {
      await supabase
        .from("veiculos")
        .update({ status: "ativo", updated_at: new Date().toISOString() })
        .eq("status", "enviado");

      await supabase.from("logs_auditoria").insert({
        user_email: "sistema",
        user_id: null,
        acao: `Sistema resetou o ciclo — ${enviadosCount} veículo${enviadosCount !== 1 ? "s" : ""} voltaram de "enviado" para "ativo"`,
        entidade: "disparo_automatico",
        entidade_id: null,
        detalhes: { acao: "ciclo_resetado", veiculos_resetados: enviadosCount, executado_em: new Date().toISOString() }
      });
    } else {
      await supabase.from("logs_auditoria").insert({
        user_email: "sistema",
        user_id: null,
        acao: "Sistema verificou a fila mas não há veículos para disparar",
        entidade: "disparo_automatico",
        entidade_id: null,
        detalhes: { acao: "sem_veiculos", executado_em: new Date().toISOString() }
      });
    }

    return NextResponse.json({ ok: true, lote: null, webhook_fired: false, next_dispatch_at: newNextIso });
  }

  // 6. Próximo lote da sequência circular — atualiza flag lote_da_vez
  const loteDisparado = proximo;

  await supabase.from("lotes").update({ lote_da_vez: false }).neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("lotes").update({ lote_da_vez: true }).eq("id", loteDisparado.id);

  // 7. Dispara o webhook com os dados do lote
  const webhookFired = await tryFireWebhook({ id: loteDisparado.id, nome: loteDisparado.nome });

  // 8. Log do disparo
  await supabase.from("logs_auditoria").insert({
    user_email: "sistema",
    user_id: null,
    acao: `Sistema disparou o webhook para o lote "${loteDisparado.nome}" (${ativosMap.get(loteDisparado.id) ?? 0} veículo${(ativosMap.get(loteDisparado.id) ?? 0) !== 1 ? "s" : ""} ativo${(ativosMap.get(loteDisparado.id) ?? 0) !== 1 ? "s" : ""})`,
    entidade: "disparo_automatico",
    entidade_id: null,
    detalhes: {
      acao: "webhook_disparado",
      lote_id: loteDisparado.id,
      lote_nome: loteDisparado.nome,
      veiculos_ativos: ativosMap.get(loteDisparado.id) ?? 0,
      executado_em: new Date().toISOString()
    }
  });

  return NextResponse.json({
    ok: true,
    lote: { id: loteDisparado.id, nome: loteDisparado.nome },
    webhook_fired: webhookFired,
    next_dispatch_at: newNextIso
  });
}
