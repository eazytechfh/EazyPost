"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, Save } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { cleanCurrencyInput, parseCurrencyInput } from "@/lib/format";
import { RichTextEditor } from "./rich-text-editor";
import { SectionHeader } from "./section-header";

type FormState = {
  nome_anuncio: string;
  quilometragem: string;
  motor: string;
  valor: string;
  cor: string;
  fipe: string;
  placa: string;
  ano: string;
  texto_anuncio: string;
};

function buildAnuncioTemplate(fields: {
  nome_anuncio: string;
  fipe: string;
  valor: string;
  ano: string;
  quilometragem: string;
  placa: string;
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

  return `${nome}

💸 FIPE: ${fipe}
💰 VALOR: ${valorDisplay}

ANO: ${ano} | KM: ${km}
CÂMBIO:
PNEUS: BONS
PERÍCIA: APROVA ✅
PLACA: XXX-${placa}

SEM LEILÃO | SEM SINISTRO ✅

PAGAMENTO NO CARTÃO DE CRÉDITO EM ATÉ 24X, FINANCIAMENTO EM TODOS OS BANCOS, SEM ENTRADA, SUJEITO À ANÁLISE DE CRÉDITO. CONSULTE NOSSOS VENDEDORES

VEÍCULOS PARA FORA DO ESTADO DO PARANÁ: ADICIONAL DE 1% DO VALOR DA VENDA PARA NF

📍 CURITIBA`;
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
  texto_anuncio: buildAnuncioTemplate({ nome_anuncio: "", fipe: "", valor: "", ano: "", quilometragem: "", placa: "" })
};

export function AnuncioForm() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [form, setForm] = useState<FormState>(initialState);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setForm(current => ({
      ...current,
      texto_anuncio: buildAnuncioTemplate({
        nome_anuncio: current.nome_anuncio,
        fipe: current.fipe,
        valor: current.valor,
        ano: current.ano,
        quilometragem: current.quilometragem,
        placa: current.placa
      })
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.nome_anuncio, form.fipe, form.valor, form.ano, form.quilometragem, form.placa]);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handlePlacaChange(value: string) {
    const sanitized = value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
    updateField("placa", sanitized);
  }

  function handleFiles(nextFiles: FileList | null) {
    const selected = Array.from(nextFiles ?? []).slice(0, 4);
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

      if (error) {
        console.error("Erro ao enviar imagem para o Supabase Storage:", error);
        throw error;
      }

      const { data } = supabase.storage.from("veiculos-imagens").getPublicUrl(path);
      uploadedUrls.push(data.publicUrl);
    }

    return uploadedUrls;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      if (userError) {
        console.error("Erro ao buscar usuario autenticado:", userError);
      }

      setMessage(userError?.message ?? "Sessao expirada. Faca login novamente.");
      setLoading(false);
      return;
    }

    try {
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email ?? ""
      });

      if (profileError) {
        console.error("Erro ao garantir profile antes de cadastrar anuncio:", profileError);
        throw profileError;
      }

      const imageUrls = await uploadImages(user.id);
      const { error } = await supabase
        .from("veiculos")
        .insert({
          user_id: user.id,
          nome_anuncio: form.nome_anuncio,
          quilometragem: form.quilometragem,
          motor: form.motor,
          valor: parseCurrencyInput(form.valor),
          cor: form.cor,
          fipe: form.fipe,
          placa: `XXX-${form.placa}`,
          texto_anuncio: form.texto_anuncio,
          imagens: imageUrls,
          status: "pendente"
        });

      if (error) {
        console.error("Erro ao inserir anuncio na tabela veiculos:", error);
        throw error;
      }

      setForm(initialState);
      setFiles([]);
      setPreviews([]);
      setMessage("Anuncio cadastrado com sucesso.");
    } catch (error) {
      console.error("Erro ao cadastrar anuncio:", error);
      setMessage(getErrorMessage(error, "Nao foi possivel cadastrar o anuncio."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <SectionHeader
        title="Cadastrar Anuncio"
        description="Preencha os dados do veiculo e envie ate 4 imagens para o Supabase Storage."
      />

      <form onSubmit={handleSubmit} className="app-card max-w-5xl p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="app-label">Nome do Anuncio</span>
            <input
              className="app-input"
              value={form.nome_anuncio}
              onChange={(event) => updateField("nome_anuncio", event.target.value)}
              placeholder="Fiesta 1.0 2005"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Quilometragem (KM)</span>
            <input
              className="app-input"
              value={form.quilometragem}
              onChange={(event) => updateField("quilometragem", event.target.value)}
              placeholder="120.000"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Motor</span>
            <input
              className="app-input"
              value={form.motor}
              onChange={(event) => updateField("motor", event.target.value)}
              placeholder="1.0 Flex"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Ano</span>
            <input
              className="app-input"
              value={form.ano}
              onChange={(event) => updateField("ano", event.target.value)}
              placeholder="2019"
              maxLength={4}
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Valor</span>
            <input
              className="app-input"
              value={form.valor}
              onChange={(event) => updateField("valor", cleanCurrencyInput(event.target.value))}
              placeholder="18950"
              inputMode="numeric"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">FIPE</span>
            <input
              className="app-input"
              value={form.fipe}
              onChange={(event) => updateField("fipe", event.target.value)}
              placeholder="R$ 120.000,00"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Cor</span>
            <input
              className="app-input"
              value={form.cor}
              onChange={(event) => updateField("cor", event.target.value)}
              placeholder="Prata"
              required
            />
          </label>

          <label className="space-y-2">
            <span className="app-label">Placa</span>
            <div className="flex">
              <span className="flex items-center rounded-l-md border border-r-0 border-app-border bg-app-panel px-3 text-sm text-app-muted select-none">
                XXX-
              </span>
              <input
                className="app-input rounded-l-none"
                value={form.placa}
                onChange={(event) => handlePlacaChange(event.target.value)}
                placeholder="0000"
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
            <span className="text-sm font-semibold text-app-white">Enviar ate 4 imagens</span>
            <span className="mt-1 text-xs text-app-muted">As URLs publicas serao salvas no anuncio</span>
            <input
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => handleFiles(event.target.files)}
            />
          </label>

          {previews.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {previews.map((preview) => (
                <div key={preview} className="relative aspect-video overflow-hidden rounded-md border border-app-border">
                  <Image src={preview} alt="Preview do veiculo" fill unoptimized className="object-cover" />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {message ? <p className="mt-5 rounded-md border border-app-border bg-app-panel p-3 text-sm text-app-muted">{message}</p> : null}

        <button className="app-button mt-6" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          Cadastrar Anuncio
        </button>
      </form>
    </section>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return fallback;
}
