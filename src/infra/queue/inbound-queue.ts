import { Queue, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "../../config/logger.js";
import type { MessageRouter } from "../../core/router/message-router.js";
import { QUEUE_NAMES, type InboundMessageJob } from "./types.js";

export function createInboundQueue(connection: Redis): Queue<InboundMessageJob> {
  return new Queue<InboundMessageJob>(QUEUE_NAMES.inboundMessages, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    },
  });
}

export function startInboundWorker(params: {
  connection: Redis;
  router: MessageRouter;
  logger: Logger;
}): Worker<InboundMessageJob> {
  const worker = new Worker<InboundMessageJob>(
    QUEUE_NAMES.inboundMessages,
    async (job: Job<InboundMessageJob>) => {
      const data = job.data;
      params.logger.info(
        { jobId: job.id, eventId: data.eventId, phone: data.phone },
        "worker.inbound.start",
      );
      await params.router.handle({
        instance: data.instance,
        message: {
          phone: data.phone,
          text: data.text,
          pushName: data.pushName,
          messageType: data.messageType,
        },
      });
    },
    { connection: params.connection, concurrency: 5 },
  );

  worker.on("failed", (job, err) => {
    params.logger.error(
      { jobId: job?.id, err },
      "worker.inbound.failed",
    );
  });

  worker.on("completed", (job) => {
    params.logger.debug({ jobId: job.id }, "worker.inbound.completed");
  });

  return worker;
}
