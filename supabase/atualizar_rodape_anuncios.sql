-- Adiciona o novo rodapé (endereço + WhatsApp) aos anúncios já criados.
-- Rode no SQL Editor do Supabase. Só altera textos que ainda não têm o rodapé.

-- 1) Conferência (não altera nada): quantos anúncios serão atualizados
select count(*) as serao_atualizados
from veiculos
where texto_anuncio is not null
  and texto_anuncio not like '%Endereço: Rua Miguel José Grein%';

-- 2) Atualização
update veiculos
set texto_anuncio = rtrim(texto_anuncio, E' \n\r')
  || E'\n\n🏢 Endereço: Rua Miguel José Grein, 38 – Xaxim, Curitiba/PR.'
  || E'\n\n📲 WhatsApp de Compras: (41) 99157-2733',
    updated_at = now()
where texto_anuncio is not null
  and texto_anuncio not like '%Endereço: Rua Miguel José Grein%';
