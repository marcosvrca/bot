import type { Redis } from "ioredis";
import { env } from "../../config/env.js";

const IDEMPOTENCY_PREFIX = "idempotency:msg:";
const RATE_PREFIX = "ratelimit:";

export class IdempotencyStore {
  constructor(private readonly redis: Redis) {}

  async claim(eventId: string, ttlSeconds = 86_400): Promise<boolean> {
    const key = `${IDEMPOTENCY_PREFIX}${eventId}`;
    const result = await this.redis.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }
}

export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  async allow(tenantId: string, phone: string): Promise<boolean> {
    const window = env().RATE_LIMIT_WINDOW_SECONDS;
    const max = env().RATE_LIMIT_MAX;
    const key = `${RATE_PREFIX}${tenantId}:${phone}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, window);
    }
    return count <= max;
  }
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
