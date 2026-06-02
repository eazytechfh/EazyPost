import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { avancarLoteDaVezAction } from "@/app/actions/lotes";

const WEBHOOK_URL = "https://n8n.eazy.tec.br/webhook-test/4b4ea55a-7916-4592-b44c-875fc13d7064";
const TOTAL_SECONDS = 60 * 60;
const RETRY_DELAYS = [0, 3000, 7000, 15000];

// ---------------------------------------------------------------------------
// Dispara o webhook com retry. Sempre inclui lote_id e lote_nome no body.
// ---------------------------------------------------------------------------
async function tryFireWebhook(lote: { id: string; nome: string }): Promise<boolean> {
  const body = {
    disparar: "ok",
    lote_id: lote.id,
    lote_nome: lote.nome
  };

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
      console.warn(`[EazyPost Cron] Webhook HTTP ${res.status} — tentativa ${attempt + 1}/${RETRY_DELAYS.length}`);
    } catch (err) {
      console.warn(`[EazyPost Cron] Webhook erro — tentativa ${attempt + 1}/${RETRY_DELAYS.length}:`, err);
    }
  }
  console.error("[EazyPost Cron] Webhook falhou após todas as tentativas.");
  return false;
}

// ---------------------------------------------------------------------------
// GET /api/cron/dispatch
// Chamado pelo Vercel Cron (ou serviço externo) a cada minuto.
// Só dispara se next_dispatch_at já passou.
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  // Autenticação: valida CRON_SECRET se configurado no ambiente
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createSupabaseServerClient();

  // Lê o próximo disparo agendado
  const { data: configRaw } = await supabase
    .from("dispatch_config")
    .select("next_dispatch_at")
    .eq("id", 1)
    .maybeSingle();

  const currentIso = (configRaw as { next_dispatch_at: string } | null)?.next_dispatch_at ?? null;
  const nextAt = currentIso ? new Date(currentIso).getTime() : 0;
  const now = Date.now();

  // Ainda não é hora de disparar
  if (nextAt > now) {
    const remainingSec = Math.round((nextAt - now) / 1000);
    return NextResponse.json({ ok: false, reason: "not_yet", remaining_seconds: remainingSec });
  }

  // Calcula o próximo disparo (T + 1h)
  const newNextIso = new Date(now + TOTAL_SECONDS * 1000).toISOString();

  // Claim atômico: só prossegue se ganhar a corrida (evita duplo disparo)
  if (currentIso) {
    const { data: claimed } = await supabase
      .from("dispatch_config")
      .update({ next_dispatch_at: newNextIso })
      .eq("id", 1)
      .eq("next_dispatch_at", currentIso)
      .select("id");

    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ ok: false, reason: "already_claimed" });
    }
  } else {
    await supabase
      .from("dispatch_config")
      .update({ next_dispatch_at: newNextIso })
      .eq("id", 1);
  }

  // Avança a fila e dispara o webhook
  const { loteFoiDisparado, error: filaErr } = await avancarLoteDaVezAction();
  if (filaErr) console.error("[EazyPost Cron] Erro ao avançar fila:", filaErr);

  let webhookFired = false;
  if (loteFoiDisparado) {
    webhookFired = await tryFireWebhook(loteFoiDisparado);
  }

  return NextResponse.json({
    ok: true,
    lote: loteFoiDisparado,
    webhook_fired: webhookFired,
    next_dispatch_at: newNextIso
  });
}
