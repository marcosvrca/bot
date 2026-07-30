import type { FastifyInstance } from "fastify";
import type { Queue } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Logger } from "../config/logger.js";
import type { InboundMessageJob } from "../infra/queue/types.js";
import { IdempotencyStore } from "../core/security/guards.js";
import { webhookAuthHook } from "../core/security/webhook-auth.js";
import { parseEvolutionWebhook } from "../core/messaging/webhook-parser.js";
import { LeadRepository } from "../models/leads/lead.repository.js";
import { CatalogRepository } from "../models/catalog/catalog.repository.js";

export async function registerRoutes(
  app: FastifyInstance,
  deps: {
    prisma: PrismaClient;
    redis: Redis;
    inboundQueue: Queue<InboundMessageJob>;
    logger: Logger;
  },
): Promise<void> {
  const idempotency = new IdempotencyStore(deps.redis);
  const leads = new LeadRepository(deps.prisma);
  const catalog = new CatalogRepository(deps.prisma);

  app.get("/health", async (_request, reply) => {
    let dbOk = false;
    let redisOk = false;
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }
    try {
      const pong = await deps.redis.ping();
      redisOk = pong === "PONG";
    } catch {
      redisOk = false;
    }

    const ok = dbOk && redisOk;
    return reply.code(ok ? 200 : 503).send({
      status: ok ? "ok" : "degraded",
      db: dbOk,
      redis: redisOk,
      uptime: process.uptime(),
    });
  });

  /** Lista leads do tenant (CRM básico). Auth: mesmo segredo do webhook. */
  app.get(
    "/tenants/:slug/leads",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const query = request.query as { limit?: string };
      const limit = query.limit ? Number(query.limit) : 50;

      const tenant = await deps.prisma.tenant.findUnique({ where: { slug } });
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }

      const items = await leads.listByTenant(tenant.id, Number.isFinite(limit) ? limit : 50);
      return reply.send({
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        count: items.length,
        leads: items,
      });
    },
  );

  /** Lista itens do catálogo do tenant. Auth: mesmo segredo do webhook. */
  app.get(
    "/tenants/:slug/catalog",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const query = request.query as { limit?: string; q?: string };
      const limit = query.limit ? Number(query.limit) : 50;

      const tenant = await deps.prisma.tenant.findUnique({ where: { slug } });
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }

      const items = query.q?.trim()
        ? await catalog.search(tenant.id, query.q)
        : await catalog.listActive(tenant.id, Number.isFinite(limit) ? limit : 50);

      return reply.send({
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        count: items.length,
        items,
      });
    },
  );

  app.post(
    "/webhooks/evolution",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const inbound = parseEvolutionWebhook(request.body);
      if (!inbound) {
        return reply.code(200).send({ ok: true, ignored: true });
      }

      const claimed = await idempotency.claim(inbound.eventId);
      if (!claimed) {
        deps.logger.info({ eventId: inbound.eventId }, "webhook.duplicate");
        return reply.code(200).send({ ok: true, duplicate: true });
      }

      const jobId = inbound.eventId.replace(/[:|]/g, "_");
      await deps.inboundQueue.add(
        "inbound",
        {
          eventId: inbound.eventId,
          instance: inbound.instance,
          phone: inbound.phone,
          text: inbound.text,
          messageType: inbound.messageType,
          pushName: inbound.pushName,
          raw: inbound.raw,
          receivedAt: new Date().toISOString(),
        },
        { jobId },
      );

      deps.logger.info(
        {
          eventId: inbound.eventId,
          instance: inbound.instance,
          phone: inbound.phone,
        },
        "webhook.enqueued",
      );

      return reply.code(200).send({ ok: true, queued: true });
    },
  );
}
