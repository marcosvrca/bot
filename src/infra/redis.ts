import { Redis } from "ioredis";
import type { Logger } from "../config/logger.js";
import { env } from "../config/env.js";

export function createRedis(logger: Logger): Redis {
  const redis = new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  redis.on("error", (err: Error) => {
    logger.error({ err }, "redis.error");
  });

  redis.on("connect", () => {
    logger.info("redis.connected");
  });

  return redis;
}

export type { Redis };
