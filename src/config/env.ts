import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  EVOLUTION_BASE_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(8),
  WEBHOOK_SECRET: z.string().min(16),
  /**
   * URL que a Evolution chama (deve ser alcançável pelo container).
   * Em Docker Desktop (Windows/Mac): host.docker.internal
   */
  WEBHOOK_PUBLIC_URL: z
    .string()
    .url()
    .default("http://host.docker.internal:3000/webhooks/evolution"),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  DEMO_TENANT_SLUG: z.string().default("demo"),
  DEMO_EVOLUTION_INSTANCE: z.string().default("demo"),
  DEMO_DEFAULT_MODEL: z
    .enum(["menu", "scheduling", "scheduling-google", "clinic", "leads", "catalog"])
    .default("menu"),
  REMINDER_POLL_MS: z.coerce.number().int().positive().default(30_000),
  CLINIC_API_URL: z.string().url().default("http://localhost:4000"),
  CLINIC_API_KEY: z.string().min(8).default("clinic-api-key-change-me-16"),
  /** OAuth do Google Calendar (modelo scheduling-google). Opcionais para o app subir sem esse bot. */
  GOOGLE_CALENDAR_CLIENT_ID: z.string().default(""),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.string().default(""),
  GOOGLE_CALENDAR_REFRESH_TOKEN: z.string().default(""),
  GOOGLE_CALENDAR_ID: z.string().default("primary"),
  GOOGLE_CALENDAR_TIMEZONE: z.string().default("America/Sao_Paulo"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  cached = parsed.data;
  return parsed.data;
}

export function env(): Env {
  if (!cached) {
    return loadEnv();
  }
  return cached;
}
