"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export function LoginForm() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setLoading(false);

    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    router.replace("/dashboard/anuncio");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-app-black px-4 text-app-white">
      <section className="w-full max-w-md rounded-lg border border-app-border bg-app-panel p-6">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-normal">
            Eazy<span className="text-app-green">Post</span>
          </h1>
          <p className="mt-2 text-sm text-app-muted">Anuncios de veiculos para grupos WhatsApp</p>
        </div>

        <div className="mb-6 grid grid-cols-2 rounded-md border border-app-border bg-app-card p-1">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded-md px-3 py-2 text-sm font-bold transition ${
              mode === "login" ? "bg-app-green text-app-black" : "text-app-muted"
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded-md px-3 py-2 text-sm font-bold transition ${
              mode === "signup" ? "bg-app-green text-app-black" : "text-app-muted"
            }`}
          >
            Cadastro
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block space-y-2">
            <span className="app-label">Email</span>
            <span className="relative block">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" size={18} />
              <input
                className="app-input pl-10"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="voce@email.com"
                required
              />
            </span>
          </label>

          <label className="block space-y-2">
            <span className="app-label">Senha</span>
            <span className="relative block">
              <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" size={18} />
              <input
                className="app-input pl-10"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                placeholder="minimo 6 caracteres"
                required
              />
            </span>
          </label>

          {message ? <p className="rounded-md border border-app-border bg-app-card p-3 text-sm text-app-muted">{message}</p> : null}

          <button className="app-button w-full" disabled={loading}>
            {loading ? "Processando..." : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>
      </section>
    </main>
  );
}
