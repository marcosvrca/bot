import type { FastifyInstance } from "fastify";
import type { Queue } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Logger } from "../config/logger.js";
import type { InboundMessageJob } from "../infra/queue/types.js";
import { IdempotencyStore } from "../core/security/guards.js";
import { webhookAuthHook } from "../core/security/webhook-auth.js";
import { parseEvolutionWebhook } from "../core/messaging/webhook-parser.js";

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
