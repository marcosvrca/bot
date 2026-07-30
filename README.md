# Plataforma de Bots WhatsApp (Evolution API)

Bot modular, seguro e pronto para evolução multi-cliente. Modelos prontos: **Menu** (hub), **Leads/CRM**, **Catálogo**, **Agenda**, **Agenda + Google Calendar** e **Clínica**.

## Stack

- Node.js + TypeScript + Fastify
- PostgreSQL + Prisma
- Redis (sessão, rate limit, idempotência) + BullMQ (fila de webhooks)
- Evolution API (WhatsApp)

## Arquitetura rápida

```
WhatsApp → Evolution API → POST /webhooks/evolution → BullMQ → MessageRouter → BotModel → Evolution sendText
```

Modelos implementam o contrato `BotModel` (`src/models/types.ts`). O tenant escolhe modelos ativos e o fluxo de menu via `TenantConfig`.

## Subir infra local

```bash
# 1) Variáveis
cp .env.example .env

# 2) Postgres + Redis + Evolution
docker compose up -d postgres redis evolution-api

# 3) App
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

Healthcheck: [http://localhost:3000/health](http://localhost:3000/health)

### Subir app também no Docker

```bash
docker compose --profile full up -d --build
```

## Conectar WhatsApp (pelo painel)

1. Abra o dashboard e faça login
2. Clique em **Conectar canal**
3. Escaneie o QR Code com o WhatsApp
4. O status muda para **Canal: conectado**

O backend cria/usa a instância Evolution do tenant, configura o webhook automaticamente (`WEBHOOK_PUBLIC_URL`) e exibe o QR retornado pela Evolution.

Variável importante no `.env`:

```
WEBHOOK_PUBLIC_URL=http://host.docker.internal:3000/webhooks/evolution
```

## Conectar WhatsApp (manual na Evolution)

1. Abra a Evolution em `http://localhost:8080`
2. Crie a instância com o nome `demo` (igual a `DEMO_EVOLUTION_INSTANCE`)
3. Use a API key de `EVOLUTION_API_KEY`
4. Escaneie o QR Code
5. Configure o webhook da instância para:

```
URL: http://host.docker.internal:3000/webhooks/evolution
Events: MESSAGES_UPSERT
Header: x-webhook-secret = valor de WEBHOOK_SECRET
```

> No Linux, troque `host.docker.internal` pelo IP da máquina ou use a rede do compose (`http://bot:3000/...` com profile `full`).

Exemplo via API Evolution:

```bash
curl -X POST "http://localhost:8080/webhook/set/demo" \
  -H "apikey: SUA_EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"webhook\": {
      \"enabled\": true,
      \"url\": \"http://host.docker.internal:3000/webhooks/evolution\",
      \"headers\": { \"x-webhook-secret\": \"SUA_WEBHOOK_SECRET\" },
      \"events\": [\"MESSAGES_UPSERT\"]
    }
  }"
```

## Testar o Modelo Menu

1. Envie `modelo menu`
2. O bot responde com o menu
3. Digite `1`–`6` (horários, serviços, catálogo, lead, agenda, atendente)
4. Digite `menu` para recomeçar ou `sair` para encerrar a sessão

O Menu funciona como **hub**: opções podem abrir outros modelos (`catalog`, `leads`, `scheduling`) sem o cliente digitar comando técnico.

## Testar o Modelo Catálogo

1. Envie `modelo catalogo` **ou** no menu escolha `3`
2. `1` lista produtos · `2` busca · `3` categorias · número abre detalhe/preço
3. No detalhe, digite `quero` para ir ao CRM com o interesse pré-preenchido

Listar catálogo via API:

```bash
curl -H "x-webhook-secret: SUA_WEBHOOK_SECRET" \
  "http://localhost:3000/tenants/demo/catalog"
```

## Testar o Modelo Leads / CRM

1. Envie `modelo leads` **ou** no menu escolha `4` (Quero ser contactado)
2. Informe nome → e-mail (ou `pular`) → interesse → cidade → `sim`
3. O lead é salvo no Postgres (`Lead`)
4. Opcional: configure `leadsWebhookUrl` no `TenantConfig` para POST automático (Make, n8n, CRM, Sheets)

Listar leads (mesmo segredo do webhook):

```bash
curl -H "x-webhook-secret: SUA_WEBHOOK_SECRET" \
  "http://localhost:3000/tenants/demo/leads"
```

## Testar o Modelo Agenda

Além de criar/listar/editar/cancelar:

- `6` — Confirmar presença (status `confirmed`)
- `7` — Reagendar (nova data/hora)

## Testar o Modelo Clínica (psicologia)

Com a API em `../clinica-psicologia` rodando (`npm run dev` na porta 4000):

1. Envie `modelo clinica`
2. `1` agendar → serviço → psicólogo → horário livre → nome → confirmar
3. `2` listar consultas
4. `3` cancelar / `4` remarcar

Troca rápida:

- `modelo menu`
- `modelo catalogo`
- `modelo leads`
- `modelo agenda`
- `modelo agenda google`
- `modelo clinica`

## Testar o Modelo Agenda + Google Calendar

Modelo independente (`scheduling-google`): mesma UX da Agenda, mas cria/edita/cancela eventos no Google Calendar. Não altera o modelo `scheduling`.

1. No [Google Cloud Console](https://console.cloud.google.com/): crie um projeto, ative **Google Calendar API**, crie credenciais OAuth (tipo Desktop ou Web).
2. Gere um `refresh_token` com escopo `https://www.googleapis.com/auth/calendar.events`.
3. Preencha no `.env`:

```
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
GOOGLE_CALENDAR_REFRESH_TOKEN=...
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_TIMEZONE=America/Sao_Paulo
```

4. `npx prisma db push` (tabela `GoogleAppointment`)
5. No WhatsApp: `modelo agenda google` → `1` criar compromisso → confirmar

Para um cliente só com esse bot: no `TenantConfig`, use `activeModels: ["scheduling-google"]` e `defaultModel: "scheduling-google"`.

## Dashboard (painel do cliente)

Abra [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

1. **Tenant**: slug do cliente (seed: `demo`)
2. **Segredo**: valor de `WEBHOOK_SECRET` do `.env`
3. Abas: Resumo · Leads · Mensagens · Agenda · Catálogo
4. Atualização automática a cada 30s

APIs (mesmo header `x-webhook-secret`):

- `GET /api/dashboard/:slug/overview`
- `GET /api/dashboard/:slug/conversations`
- `GET /api/dashboard/:slug/conversations/:phone`
- `POST /api/dashboard/:slug/conversations/:phone/reply` (assume atendimento humano)
- `POST /api/dashboard/:slug/conversations/:phone/takeover` `{ "enabled": true|false }`
- `GET /api/dashboard/:slug/leads`
- `GET /api/dashboard/:slug/messages`
- `GET /api/dashboard/:slug/appointments`
- `GET /api/dashboard/:slug/catalog`

Na aba **Mensagens**, o painel funciona como inbox WhatsApp: lista de conversas, bolhas, envio de resposta e **Assumir / Devolver ao bot** (pausa o bot naquele contato).

### Gestão no painel

| Aba | O que o usuário faz |
|-----|---------------------|
| Menu do bot | Criar/editar/remover nós, definir início, publicar ou restaurar padrão |
| Catálogo | CRUD de produtos (preço, categoria, SKU, ativo/inativo) |
| Leads | Editar status/notas e excluir |
| Agenda | Cancelar compromissos |
| Configurações | Nome, modelos ativos, modelo padrão, webhook de CRM, celulares do dono |

## Dono só no celular (sem painel no dia a dia)

Para clientes que quase não usam computador (ex.: fisioterapeuta domiciliar):

1. Cadastre o celular em **Configurações → Celulares do dono** (ou `ownerPhones` no seed)
2. No WhatsApp do negócio, o dono digita `admin`
3. Gerencia agenda, leads e catálogo/preços **no próprio WhatsApp**

O painel web fica só para implantação (QR / conectar canal) e suporte.

### Produto Fisio (simulação de venda)

```bash
FISIO_OWNER_PHONE=55SEUNUMERO npm run db:seed:fisio
```

Cria o tenant `fisio` (instância Evolution `fisio`) com menu de agendamento, catálogo e CRM. Pacote comercial e proposta: pasta irmã `../mvflow-fisio`.

## Segurança (v1)

- Auth do webhook (`x-webhook-secret` ou `apikey`)
- Idempotência por ID da mensagem (Redis)
- Rate limit por tenant + telefone
- Processamento assíncrono (webhook responde 200 rápido)
- Isolamento por `tenantId` + `evolutionInstance`

## Estrutura

```
src/
  config/          # env Zod + logger
  infra/           # prisma, redis, queue
  http/            # health, webhook, dashboard API
  core/            # messaging, session, router, security
  models/          # contrato + menu/ leads/ catalog/ scheduling/ scheduling-google/ clinic/
  tenants/         # resolução multi-tenant
public/dashboard/  # painel web (HTML/CSS/JS)
prisma/            # schema + seed demo
```

## Scripts

| Comando | Uso |
|---------|-----|
| `npm run dev` | API + worker em watch |
| `npm run build` / `npm start` | produção |
| `npm test` | testes unitários (menu, leads, parsers) |
| `npm run db:push` | schema no Postgres |
| `npm run db:seed` | tenant demo |

## Checklist de validação

1. `docker compose up -d postgres redis evolution-api`
2. `npm run dev` sobe sem erro
3. `GET /health` retorna `db: true`, `redis: true`
4. Instância Evolution `demo` conectada (QR)
5. Webhook apontando para `/webhooks/evolution`
6. Mensagem no WhatsApp → menu responde
7. Navegação `1`–`6`, catálogo via `3`, lead via `4`, reset com `menu`
8. `GET /tenants/demo/leads` e `GET /tenants/demo/catalog`
9. Abrir `/dashboard` com slug `demo` + `WEBHOOK_SECRET`
10. Reiniciar o app: sessão Redis/Postgres respeita TTL

## Produto Start / Business (entrega)

| Capacidade | Modelo | Status |
|------------|--------|--------|
| Menu inteligente / FAQ / handoff humano | `menu` | Pronto |
| Captura de lead (CRM) + webhook | `leads` | Pronto |
| Catálogo + preços + interesse → CRM | `catalog` | Pronto |
| Agendamento + lembretes | `scheduling` | Pronto |
| Confirmação / reagendamento / cancelamento | `scheduling` | Pronto |
| Hub Menu → Catálogo / Leads / Agenda | router handoff | Pronto |
| Dashboard (métricas + listas) | `/dashboard` | Pronto |

## Próximos modelos

Ordem prevista: IA (FAQ com docs, quando houver provedor) → integrações ERP / financeiro.
