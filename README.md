# EazyPost

Sistema de gerenciamento e disparo automático de anúncios de veículos via WhatsApp, com orquestração por lotes e automação via N8N.

---

## Links Externos

| Serviço    | URL                                                                                      |
|------------|------------------------------------------------------------------------------------------|
| Vercel     | https://vercel.com/eazytechfh-gmailcoms-projects/eazy-post-pxgx                         |
| GitHub     | https://github.com/eazytechfh/EazyPost                                                   |
| N8N        | https://n8n.eazy.tec.br/workflow/kCfhDf7w77PeG0Ou                                       |
| Webhook    | https://n8n.eazy.tec.br/webhook/4b4ea55a-7916-4592-b44c-875fc13d7064                    |
| Supabase   | Configurado via variáveis de ambiente (ver seção abaixo)                                  |
| UAZAPI     | Configurado via `UAZAPI_BASE_URL` (gerenciador de instâncias WhatsApp)                   |

---

## Stack

- **Frontend/Backend**: Next.js 14 (App Router, Server Actions)
- **Banco de dados**: Supabase (PostgreSQL + RLS + Realtime)
- **Auth**: Supabase Auth
- **WhatsApp**: UAZAPI (gerenciamento de instâncias)
- **Automação**: N8N (orquestração do disparo por lotes)
- **Deploy**: Vercel (serverless, com cron via N8N)
- **Estilização**: Tailwind CSS

---

## Variáveis de Ambiente

Devem ser configuradas na Vercel e localmente em `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
UAZAPI_BASE_URL=
UAZAPI_TOKEN=
CRON_SECRET=
```

> `CRON_SECRET` protege o endpoint `/api/cron/dispatch` contra chamadas não autorizadas.
> O N8N deve enviar o header `Authorization: Bearer <CRON_SECRET>` ao chamar o endpoint.

---

## Desenvolvimento Local

```bash
npm install
npm run dev     # http://127.0.0.1:3000
npm run build   # build de produção
npm run lint    # lint
```

---

## Arquitetura do Sistema de Disparos

### Fluxo geral

```
N8N (Schedule) → /api/cron/dispatch (Next.js) → Webhook N8N → WhatsApp (UAZAPI)
```

1. **N8N** chama `/api/cron/dispatch` periodicamente.
2. O endpoint verifica se é hora de disparar (via `dispatch_config.next_dispatch_at` no Supabase).
3. Se sim, seleciona o lote com mais veículos ativos e dispara o webhook N8N.
4. O N8N recebe o `lote_id` e `lote_nome`, busca os veículos e os envia via WhatsApp.

### Nó "VERIFICA HORÁRIO" (N8N — Code JavaScript)

Controla se o disparo pode ocorrer no horário atual (America/Sao_Paulo).
**Horários permitidos:** 9h, 10h, 13h, 14h, 15h, 16h, 17h  
**Dias proibidos:** Domingo (tratado no endpoint `/api/cron/dispatch`)

### Lotes

- Cada lote comporta até **10 veículos** (`LOTE_CAPACITY = 10`).
- A fila de disparo é ordenada por: `veículos ativos DESC → total de veículos DESC → data de criação ASC`.
- Ao esvaziar todos os lotes, o sistema reinicia o ciclo (status `enviado` → `ativo`).
- Lote "Vendidos" é excluído da fila e nunca dispara.

### Constante LOTE_CAPACITY

Aparece em **3 arquivos** — sempre alterar os três juntos:
- `app/actions/anuncio.ts` — controla alocação de novos veículos
- `components/programacao.tsx` — exibe barra de progresso visual
- `components/veiculos-list.tsx` — controla movimentação e exibição de lotes

---

## Arquivos-Chave

| Arquivo                              | Responsabilidade                                      |
|--------------------------------------|-------------------------------------------------------|
| `app/api/cron/dispatch/route.ts`     | Endpoint do cron — lógica de disparo e claim atômico  |
| `app/actions/lotes.ts`               | Fila de programação, avanço e reset de ciclo          |
| `app/actions/anuncio.ts`             | Criação de anúncio, alocação em lote, marcação vendido|
| `app/actions/whatsapp.ts`            | CRUD de instâncias WhatsApp via UAZAPI                |
| `components/programacao.tsx`         | Visualização da fila de disparo (tempo real)          |
| `components/veiculos-list.tsx`       | Lista/edição/movimentação de veículos e lotes         |
| `lib/env.ts`                         | Leitura segura das variáveis de ambiente              |

---

## Regras para a IA ao Fazer Alterações

> **ATENÇÃO: O sistema está em produção. Siga estas regras antes de qualquer mudança.**

1. **Nunca interromper funcionalidades existentes.** Testar o raciocínio antes de editar.
2. **Trabalhar como engenheiro sênior** — pensar em edge cases, atomicidade, RLS.
3. **Verificar segurança** — sem SQL injection, sem exposição de service role key, sem bypass de autenticação.
4. **Constantes críticas** — `LOTE_CAPACITY` existe em 3 arquivos; alterar os 3 juntos ou nenhum.
5. **Nunca subir para produção sem autorização explícita do usuário.** Apresentar o plano primeiro.
6. **Links e informações úteis** — registrar no README sempre que fornecidos pelo usuário.
7. **Ao final de cada alteração** — atualizar a seção de Changelog abaixo com o que foi feito e cuidados futuros.
8. **Endpoint `/api/cron/dispatch`** — tem claim atômico no Supabase. Qualquer mudança na lógica de `next_dispatch_at` pode causar duplo-disparo ou parada total.
9. **Nó N8N "VERIFICA HORÁRIO"** — alterações de horário são feitas diretamente no N8N, não no código Next.js.
10. **Domingos** — o sistema bloqueia disparos automaticamente no endpoint (verificação de `diaSemana === "Sun"`).

---

## Changelog

### 2026-06-11
- Criado este README.md com documentação completa do projeto.
- `LOTE_CAPACITY` alterado de 16 para **10** em 4 lugares: `app/actions/anuncio.ts`, `app/actions/lotes.ts`, `components/programacao.tsx`, `components/veiculos-list.tsx`.
- `rebalancearLotesAction` adicionada em `app/actions/lotes.ts`: move veículos excedentes (posição > 10) de lotes lotados para lotes com espaço, criando novos lotes se necessário. Renumera posições após a migração. Acessível via botão "Rebalancear Lotes" na página Admin.
  - Cuidado futuro: a action só redistribui veículos com status diferente de "vendido". Veículos vendidos ficam no Lote Vendidos e nunca são afetados.
- N8N — nó "VERIFICA HORÁRIO" atualizado pelo usuário para horários específicos: 9h, 10h, 13h, 14h, 15h, 16h, 17h (removidos 11h, 12h, 18h). O campo de saída `dentro_do_expediente` foi mantido, portanto o nó IF seguinte não foi afetado.
- **Pendente:** Ajuste do intervalo alternante 1min10s ↔ 1min16s no N8N (aguardando definição do usuário sobre como configurar no workflow).

### Histórico anterior (via git)
- `54897dd` — fix: não disparar webhook aos domingos (horário de Brasília)
- `dd8c6b4` — fix: listar campos explicitamente no update para evitar erro de eslint
- `b5967b3` — fix: corrigir tipagem de updateField para passar build TypeScript
- `24df547` — fix: excluir campos UI-only do payload do Supabase no saveEdit
- `624772c` — feat: adiciona campos Pneus, Perícia Aprova, e Leilão no formulário e modal de edição
