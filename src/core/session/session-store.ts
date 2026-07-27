import type { Prisma, PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { env } from "../../config/env.js";

export type SessionRecord = {
  tenantId: string;
  phone: string;
  model: string;
  state: Record<string, unknown>;
};

const SESSION_KEY = (tenantId: string, phone: string) =>
  `session:${tenantId}:${phone}`;

export class SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly prisma: PrismaClient,
  ) {}

  async get(tenantId: string, phone: string): Promise<SessionRecord | null> {
    const cached = await this.redis.get(SESSION_KEY(tenantId, phone));
    if (cached) {
      return JSON.parse(cached) as SessionRecord;
    }

    const row = await this.prisma.conversationSession.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });
    if (!row) {
      return null;
    }

    const record: SessionRecord = {
      tenantId: row.tenantId,
      phone: row.phone,
      model: row.model,
      state: (row.state as Record<string, unknown>) ?? {},
    };
    await this.cache(record);
    return record;
  }

  async save(record: SessionRecord): Promise<void> {
    const state = record.state as Prisma.InputJsonValue;
    await this.prisma.conversationSession.upsert({
      where: {
        tenantId_phone: { tenantId: record.tenantId, phone: record.phone },
      },
      create: {
        tenantId: record.tenantId,
        phone: record.phone,
        model: record.model,
        state,
      },
      update: {
        model: record.model,
        state,
      },
    });
    await this.cache(record);
  }

  async clear(tenantId: string, phone: string): Promise<void> {
    await this.prisma.conversationSession.deleteMany({
      where: { tenantId, phone },
    });
    await this.redis.del(SESSION_KEY(tenantId, phone));
  }

  private async cache(record: SessionRecord): Promise<void> {
    await this.redis.set(
      SESSION_KEY(record.tenantId, record.phone),
      JSON.stringify(record),
      "EX",
      env().SESSION_TTL_SECONDS,
    );
  }
}
