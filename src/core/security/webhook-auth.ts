import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { timingSafeEqual } from "./guards.js";

export async function webhookAuthHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const secret = env().WEBHOOK_SECRET;
  const header =
    (request.headers["x-webhook-secret"] as string | undefined) ??
    (request.headers["apikey"] as string | undefined);

  if (!header || !timingSafeEqual(header, secret)) {
    // Also accept Evolution API key as alternative for Evolution-configured webhooks
    const evoKey = env().EVOLUTION_API_KEY;
    if (!header || !timingSafeEqual(header, evoKey)) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
  }
}
