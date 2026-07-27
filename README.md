# Plataforma de Bots WhatsApp (Evolution API)

Bot modular, seguro e pronto para evolução multi-cliente. A v1 entrega o **Modelo Menu (A)** com núcleo preparado para Agendamento, Leads, Catálogo e IA.

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

## Conectar WhatsApp (Evolution)

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

1. Envie qualquer mensagem para o número conectado
2. O bot responde com o menu
3. Digite `1`, `2` ou `3`
4. Digite `menu` para recomeçar ou `sair` para encerrar a sessão

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
  http/            # health + webhook
  core/            # messaging, session, router, security
  models/          # contrato + menu/
  tenants/         # resolução multi-tenant
prisma/            # schema + seed demo
```

## Scripts

| Comando | Uso |
|---------|-----|
| `npm run dev` | API + worker em watch |
| `npm run build` / `npm start` | produção |
| `npm test` | testes unitários (menu + parser) |
| `npm run db:push` | schema no Postgres |
| `npm run db:seed` | tenant demo |

## Checklist de validação

1. `docker compose up -d postgres redis evolution-api`
2. `npm run dev` sobe sem erro
3. `GET /health` retorna `db: true`, `redis: true`
4. Instância Evolution `demo` conectada (QR)
5. Webhook apontando para `/webhooks/evolution`
6. Mensagem no WhatsApp → menu responde
7. Navegação `1` / `2` / `3` e reset com `menu`
8. Reiniciar o app: sessão Redis/Postgres respeita TTL

## Próximos modelos

Ordem prevista: Agendamento → Leads → Catálogo → IA → composição multi-modelo no mesmo bot (Menu como hub).
