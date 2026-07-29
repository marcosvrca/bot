import Fastify from "fastify";
import type { Redis } from "ioredis";
import { loadEnv, env } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createPrisma } from "./infra/prisma.js";
import { createRedis } from "./infra/redis.js";
import { createInboundQueue, startInboundWorker } from "./infra/queue/inbound-queue.js";
import { EvolutionClient } from "./core/messaging/evolution-client.js";
import { OutboundService } from "./core/messaging/outbound-service.js";
import { SessionStore } from "./core/session/session-store.js";
import { MessageRouter } from "./core/router/message-router.js";
import { ModelRegistry } from "./models/registry.js";
import { MenuModel } from "./models/menu/menu.model.js";
import { SchedulingModel } from "./models/scheduling/scheduling.model.js";
import { startReminderWorker } from "./models/scheduling/reminder.worker.js";
import { SchedulingGoogleModel } from "./models/scheduling-google/scheduling-google.model.js";
import { startGoogleReminderWorker } from "./models/scheduling-google/reminder.worker.js";
import { ClinicHttpClient } from "./models/clinic/clinic.client.js";
import { ClinicModel } from "./models/clinic/clinic.model.js";
import { TenantService } from "./tenants/tenant-service.js";
import { registerRoutes } from "./http/routes.js";

export type AppRuntime = {
  close: () => Promise<void>;
};

export async function startApp(): Promise<AppRuntime> {
  loadEnv();
  const logger = createLogger();
  const prisma = createPrisma(logger);
  const redis = createRedis(logger);
  const queueRedis = redis.duplicate();
  const workerRedis = redis.duplicate();

  const inboundQueue = createInboundQueue(queueRedis);
  const evolution = new EvolutionClient(logger);
  const outbound = new OutboundService(evolution, prisma, logger);
  const sessions = new SessionStore(redis, prisma);
  const tenants = new TenantService(prisma);

  const registry = new ModelRegistry();
  registry.register(new MenuModel());
  registry.register(new SchedulingModel(prisma));
  registry.register(new SchedulingGoogleModel(prisma));
  registry.register(new ClinicModel(new ClinicHttpClient()));

  const router = new MessageRouter(
    tenants,
    sessions,
    registry,
    outbound,
    prisma,
    redis,
    logger,
  );

  const worker = startInboundWorker({
    connection: workerRedis,
    router,
    logger,
  });

  const reminders = startReminderWorker({
    prisma,
    outbound,
    logger,
    intervalMs: env().REMINDER_POLL_MS,
  });
  const googleReminders = startGoogleReminderWorker({
    prisma,
    outbound,
    logger,
    intervalMs: env().REMINDER_POLL_MS,
  });

  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  await registerRoutes(app, { prisma, redis, inboundQueue, logger });

  const port = env().PORT;
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port, models: registry.list() }, "app.started");

  const close = async () => {
    logger.info("app.shutting_down");
    reminders.stop();
    googleReminders.stop();
    await worker.close();
    await inboundQueue.close();
    await app.close();
    await prisma.$disconnect();
    await quitRedis(workerRedis);
    await quitRedis(queueRedis);
    await quitRedis(redis);
    logger.info("app.stopped");
  };

  return { close };
}

async function quitRedis(client: Redis): Promise<void> {
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
