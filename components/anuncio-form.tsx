"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AlertTriangle, ImagePlus, Layers, Loader2, Save, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { cleanCurrencyInput, parseCurrencyInput } from "@/lib/format";
import { criarAnuncioAction } from "@/app/actions/anuncio";
import { registrarLogComCliente } from "@/lib/audit-log";
import { RichTextEditor } from "./rich-text-editor";
import { SectionHeader } from "./section-header";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
type FormState = {
  nome_anuncio: string;
  quilometragem: string;
  motor: string;
  valor: string;
  cor: string;
  fipe: string;
  placa: string;
  ano: string;
  tipo: string;
  cambio: string;
  local: string;
  texto_anuncio: string;
};

// ---------------------------------------------------------------------------
// Template do anúncio
// ---------------------------------------------------------------------------
function buildAnuncioTemplate(fields: {
  nome_anuncio: string;
  fipe: string;
  valor: string;
  ano: string;
  quilometragem: string;
  placa: string;
  cambio: string;
  local: string;
}) {
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

  return `${nome}

💸 FIPE: ${fipe}
💰 VALOR: ${valorDisplay}

ANO: ${ano} | KM: ${km}
CÂMBIO: ${cambio}
PNEUS: BONS
PERÍCIA: APROVA ✅
PLACA: XXX-${placa}

SEM LEILÃO | SEM SINISTRO ✅

PAGAMENTO NO CARTÃO DE CRÉDITO EM ATÉ 24X, FINANCIAMENTO EM TODOS OS BANCOS, SEM ENTRADA, SUJEITO À ANÁLISE DE CRÉDITO. CONSULTE NOSSOS VENDEDORES

VEÍCULOS PARA FORA DO ESTADO DO PARANÁ: ADICIONAL DE 1% DO VALOR DA VENDA PARA NF

📍 ${local}`;
}

const initialState: FormState = {
  nome_anuncio: "",
  quilometragem: "",
  motor: "",
  valor: "",
  cor: "",
  fipe: "",
  placa: "",
  ano: "",
  tipo: "aleatorio",
  cambio: "",
  local: "",
  texto_anuncio: buildAnuncioTemplate({
    nome_anuncio: "", fipe: "", valor: "", ano: "",
    quilometragem: "", placa: "", cambio: "", local: ""
  })
};

// ---------------------------------------------------------------------------
// Formata o valor digitado para exibição no input (ex: 99900 → 99.900)
// ---------------------------------------------------------------------------
function formatValorDisplay(digits: string): string {
  if (!digits) return "";
  const num = Number(digits);
  if (!Number.isFinite(num)) return digits;
  return new Intl.NumberFormat("pt-BR").format(num);
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function AnuncioForm() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [form, setForm] = useState<FormState>(initialState);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [message, setMessage] = useState<{ text: string; lote?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [placaDuplicada, setPlacaDuplicada] = useState(false);

  // Atualiza texto do anúncio ao mudar campos relevantes
  useEffect(() => {
    setForm((current) => ({
      ...current,
      texto_anuncio: buildAnuncioTemplate({
        nome_anuncio: current.nome_anuncio,
        fipe: current.fipe,
        valor: current.valor,
        ano: current.ano,
        quilometragem: current.quilometragem,
        placa: current.placa,
        cambio: current.cambio,
        local: current.local
      })
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.nome_anuncio, form.fipe, form.valor, form.ano, form.quilometragem, form.placa, form.cambio, form.local]);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handlePlacaChange(value: string) {
    const sanitized = value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
    updateField("placa", sanitized);
  }

  function handleFiles(nextFiles: FileList | null) {
    const selected = Array.from(nextFiles ?? []).slice(0, 1);
    setFiles(selected);
    setPreviews(selected.map((file) => URL.createObjectURL(file)));
  }

  async function uploadImages(userId: string) {
    const uploadedUrls: string[] = [];
    for (const file of files) {
      const extension = file.name.split(".").pop() ?? "jpg";
      const path = `${userId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("veiculos-imagens").upload(path, file, {
        cacheControl: "3600",
        upsert: false
      });
      if (error) throw error;
      const { data } = supabase.storage.from("veiculos-imagens").getPublicUrl(path);
      uploadedUrls.push(data.publicUrl);
    }
    return uploadedUrls;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setMessage({ text: userError?.message ?? "Sessao expirada. Faca login novamente." });
      setLoading(false);
      return;
    }

    try {
      // Verifica placa duplicada
      const placaCompleta = `XXX-${form.placa}`;
      const { data: existente } = await supabase
        .from("veiculos")
        .select("id")
        .eq("placa", placaCompleta)
        .maybeSingle();

      if (existente) {
        setPlacaDuplicada(true);
        setLoading(false);
        return;
      }

      // Upload das imagens
      const imageUrls = await uploadImages(user.id);

      // Server action: insere veículo + auto-aloca em lote
      const result = await criarAnuncioAction({
        nome_anuncio: form.nome_anuncio,
        quilometragem: form.quilometragem,
        motor: form.motor,
        valor: parseCurrencyInput(form.valor),
        cor: form.cor,
        fipe: form.fipe,
        placa: placaCompleta,
        tipo: form.tipo,
        texto_anuncio: form.texto_anuncio,
        imagens: imageUrls
      });

      if (result.error) throw new Error(result.error);

      // Audit log
      if (result.data?.id) {
        await registrarLogComCliente(
          supabase,
          `Usuario ${user.email ?? ""} criou o anuncio [${form.nome_anuncio}]`,
          "anuncio",
          result.data.id,
          { nome_anuncio: form.nome_anuncio, placa: placaCompleta }
        );
      }

      setForm(initialState);
      setFiles([]);
      setPreviews([]);
      setMessage({ text: "Anuncio cadastrado com sucesso.", lote: result.data?.lote_nome });
    } catch (error) {
      console.error("Erro ao cadastrar anuncio:", error);
      setMessage({ text: getErrorMessage(error, "Nao foi possivel cadastrar o anuncio.") });
    } finally {
      setLoading(false);
    }
  }

  const valorFormatado = formatValorDisplay(form.valor);

  return (
    <section>
      <SectionHeader
        title="Cadastrar Anuncio"
        description="Preencha os dados do veiculo e envie ate 4 imagens para o Supabase Storage."
      />

      {/* Modal: placa duplicada */}
      {placaDuplicada ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-lg border border-red-500/50 bg-app-panel p-6 text-center shadow-xl">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
              <AlertTriangle size={28} className="text-red-400" />
            </div>
            <h2 className="mb-1 text-lg font-bold text-app-white">PLACA JÁ CADASTRADA</h2>
            <p className="text-sm text-app-muted">
              A placa <span className="font-bold text-red-400">XXX-{form.placa}</span> já está registrada no sistema.
              Verifique se o veículo já foi cadastrado antes de prosseguir.
            </p>
            <button
              onClick={() => setPlacaDuplicada(false)}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md border border-app-border bg-app-card py-2 text-sm font-semibold text-app-white hover:border-red-500 hover:text-red-400 transition"
            >
              <X size={15} />
              Fechar e Corrigir
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="app-card max-w-5xl p-5">
        <div className="grid gap-4 md:grid-cols-2">

          <label className="space-y-2">
            <span className="app-label">Nome do Anuncio</span>
            <input
              className="app-input"
              value={form.nome_anuncio}
              onChange={(event) => updateField("nome_anuncio", event.target.value)}
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Quilometragem (KM)</span>
            <input
              className="app-input"
              value={form.quilometragem}
              onChange={(event) => updateField("quilometragem", event.target.value)}
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Motor</span>
            <input
              className="app-input"
              value={form.motor}
              onChange={(event) => updateField("motor", event.target.value)}
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Ano</span>
            <input
              className="app-input"
              value={form.ano}
              onChange={(event) => updateField("ano", event.target.value)}
              maxLength={4}
              inputMode="numeric"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Valor</span>
            <input
              className="app-input"
              value={form.valor}
              onChange={(event) => updateField("valor", cleanCurrencyInput(event.target.value))}
              inputMode="numeric"
              required
            />
            {valorFormatado ? (
              <p className="text-xs text-app-muted">
                No anúncio: <span className="font-semibold text-app-green">{valorFormatado},00</span>
              </p>
            ) : null}
          </label>

          <label className="space-y-2">
            <span className="app-label">FIPE</span>
            <input
              className="app-input"
              value={form.fipe}
              onChange={(event) => updateField("fipe", event.target.value)}
              required
            />
            <p className="text-xs text-app-muted">Ex: 119.000,00</p>
          </label>

          <label className="space-y-2">
            <span className="app-label">Cor</span>
            <input
              className="app-input"
              value={form.cor}
              onChange={(event) => updateField("cor", event.target.value)}
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Câmbio</span>
            <input
              className="app-input"
              value={form.cambio}
              onChange={(event) => updateField("cambio", event.target.value)}
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Tipo</span>
            <select
              className="app-input"
              value={form.tipo}
              onChange={(event) => updateField("tipo", event.target.value)}
              required
            >
              <option value="aleatorio">ALEATÓRIO</option>
              <option value="prioridade">PRIORIDADE</option>
            </select>
          </label>

          <label className="space-y-2">
            <span className="app-label">Local / Fornecedor</span>
            <input
              className="app-input"
              value={form.local}
              onChange={(event) => updateField("local", event.target.value)}
              required
            />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="app-label">Placa</span>
            <div className="flex max-w-xs">
              <span className="flex items-center rounded-l-md border border-r-0 border-app-border bg-app-panel px-3 text-sm text-app-muted select-none">
                XXX-
              </span>
              <input
                className="app-input rounded-l-none"
                value={form.placa}
                onChange={(event) => handlePlacaChange(event.target.value)}
                maxLength={4}
                required
              />
            </div>
          </label>

        </div>

        <div className="mt-5 space-y-2">
          <span className="app-label">Texto do Anuncio</span>
          <RichTextEditor value={form.texto_anuncio} onChange={(value) => updateField("texto_anuncio", value)} />
        </div>

        <div className="mt-5 space-y-3">
          <span className="app-label">Imagens</span>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-app-border bg-app-panel px-4 py-8 text-center transition hover:border-app-green">
            <ImagePlus className="mb-2 text-app-green" size={28} />
            <span className="text-sm font-semibold text-app-white">Enviar imagem</span>
            <span className="mt-1 text-xs text-app-muted">A URL publica sera salva no anuncio</span>
            <input
              className="hidden"
              type="file"
              accept="image/*"
              onChange={(event) => handleFiles(event.target.files)}
            />
          </label>

          {previews[0] ? (
            <div className="relative aspect-video max-w-sm overflow-hidden rounded-md border border-app-border">
              <Image src={previews[0]} alt="Preview do veiculo" fill unoptimized className="object-cover" />
            </div>
          ) : null}
        </div>

        {message ? (
          <div className="mt-5 rounded-md border border-app-border bg-app-panel p-3 text-sm text-app-muted">
            <p>{message.text}</p>
            {message.lote ? (
              <p className="mt-1 flex items-center gap-1.5 font-semibold text-app-green">
                <Layers size={13} />
                Alocado em: {message.lote}
              </p>
            ) : null}
          </div>
        ) : null}

        <button className="app-button mt-6" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          Cadastrar Anuncio
        </button>
      </form>
    </section>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}
