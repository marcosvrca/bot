import type { PrismaClient, Tenant, TenantConfig } from "@prisma/client";
import type { BotModelId } from "../models/types.js";

export type TenantBundle = {
  tenant: Tenant;
  config: TenantConfig;
};

export class TenantService {
  constructor(private readonly prisma: PrismaClient) {}

  async findByInstance(instance: string): Promise<TenantBundle | null> {
    const config = await this.prisma.tenantConfig.findUnique({
      where: { evolutionInstance: instance },
      include: { tenant: true },
    });
    if (!config || !config.tenant.active) {
      return null;
    }
    return { tenant: config.tenant, config };
  }

  resolveDefaultModel(config: TenantConfig): BotModelId {
    const active = config.activeModels;
    const preferred = config.defaultModel;
    if (active.includes(preferred)) {
      return preferred as BotModelId;
    }
    const first = active[0];
    if (!first) {
      throw new Error(`Tenant ${config.tenantId} has no active models`);
    }
    return first as BotModelId;
  }
}
