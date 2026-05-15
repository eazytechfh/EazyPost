"use client";

import { Bold, Italic, SmilePlus } from "lucide-react";

const emojis = ["🚗", "✅", "🔥", "💰", "📲", "⭐"];

export function RichTextEditor({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  function wrapSelection(before: string, after = before) {
    const textarea = document.getElementById("texto_anuncio") as HTMLTextAreaElement | null;

    if (!textarea) {
      onChange(`${value}${before}${after}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
    onChange(next);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    });
  }

  function insertEmoji(emoji: string) {
    const textarea = document.getElementById("texto_anuncio") as HTMLTextAreaElement | null;
    const start = textarea?.selectionStart ?? value.length;
    const next = `${value.slice(0, start)}${emoji}${value.slice(start)}`;
    onChange(next);
  }

  return (
    <div className="rounded-md border border-app-border bg-app-card focus-within:border-app-green focus-within:shadow-green">
      <div className="flex flex-wrap items-center gap-2 border-b border-app-border p-2">
        <button
          type="button"
          onClick={() => wrapSelection("**")}
          title="Negrito"
          className="rounded-md border border-app-border p-2 text-app-white transition hover:border-app-green hover:text-app-green"
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          onClick={() => wrapSelection("_")}
          title="Italico"
          className="rounded-md border border-app-border p-2 text-app-white transition hover:border-app-green hover:text-app-green"
        >
          <Italic size={16} />
        </button>
        <span className="flex items-center gap-1 text-app-muted">
          <SmilePlus size={16} />
          {emojis.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => insertEmoji(emoji)}
              className="rounded-md px-2 py-1 text-base transition hover:bg-app-panel"
            >
              {emoji}
            </button>
          ))}
        </span>
      </div>
      <textarea
        id="texto_anuncio"
        className="min-h-44 w-full resize-y rounded-b-md bg-app-card p-3 text-sm text-app-white outline-none placeholder:text-app-muted"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Descreva o veiculo com detalhes, emojis, **negrito** e _italico_"
        required
      />
    </div>
  );
}
