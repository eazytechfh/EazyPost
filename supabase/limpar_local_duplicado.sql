-- Remove o endereço/telefone antigos que ficaram na linha "📍 ..." (agora duplicados
-- pelo bloco "🏢 Endereço / 📲 WhatsApp"). Só mexe na parte ANTES do bloco novo.
-- Rode no SQL Editor do Supabase, na ordem: 0 (backup), 1 (prévia), 2 (update).

-- 0) Backup dos textos atuais (rode uma vez)
create table if not exists veiculos_backup_texto_rodape as
select id, texto_anuncio from veiculos;

-- 1) Prévia (não altera nada): antes x depois da linha 📍
with base as (
  select id,
         substring(texto_anuncio from 1 for position(E'🏢 Endereço' in texto_anuncio) - 1) as head,
         substring(texto_anuncio from position(E'🏢 Endereço' in texto_anuncio)) as tail
  from veiculos
  where position(E'🏢 Endereço' in texto_anuncio) > 0
),
limpo as (
  select id, head, tail,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(head, E'\n📲\\s*\\(41\\)\\s*99157-2733\\s*', E'\n', 'gi'),
          E'[ \\-–/]*(MR\\s*-\\s*)?RUA\\s+MIGUEL\\s+JOS[ÉE]\\s+GREIN\\s*,?\\s*38\\s*,?\\s*XAXIM', '', 'gi'),
        E'\\s*\\(41\\)\\s*99157-2733', '', 'gi'),
      E'[ /]+(\n)', E'\\1', 'g') as novo_head
  from base
)
select id,
       substring(head from position('📍' in head)) as antes,
       substring(novo_head from position('📍' in novo_head)) as depois
from limpo
where head <> novo_head
limit 30;

-- 2) Atualização (rode só depois de conferir a prévia, e rode separado do passo 1)
with base as (
  select id,
         substring(texto_anuncio from 1 for position(E'🏢 Endereço' in texto_anuncio) - 1) as head,
         substring(texto_anuncio from position(E'🏢 Endereço' in texto_anuncio)) as tail
  from veiculos
  where position(E'🏢 Endereço' in texto_anuncio) > 0
),
limpo as (
  select id, head, tail,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(head, E'\n📲\\s*\\(41\\)\\s*99157-2733\\s*', E'\n', 'gi'),
          E'[ \\-–/]*(MR\\s*-\\s*)?RUA\\s+MIGUEL\\s+JOS[ÉE]\\s+GREIN\\s*,?\\s*38\\s*,?\\s*XAXIM', '', 'gi'),
        E'\\s*\\(41\\)\\s*99157-2733', '', 'gi'),
      E'[ /]+(\n)', E'\\1', 'g') as novo_head
  from base
)
update veiculos v
set texto_anuncio = l.novo_head || l.tail,
    updated_at = now()
from limpo l
where v.id = l.id
  and l.head <> l.novo_head;
