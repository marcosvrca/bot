import pino from "pino";
import { env } from "./env.js";

export function createLogger() {
  const isDev = env().NODE_ENV === "development";
  return pino({
    level: env().LOG_LEVEL,
    transport: isDev
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        }
      : undefined,
    base: { service: "whatsapp-bot-platform" },
  });
}

export type Logger = ReturnType<typeof createLogger>;
