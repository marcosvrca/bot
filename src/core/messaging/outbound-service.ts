import type { EvolutionClient } from "./evolution-client.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "../../config/logger.js";

export type OutboundMessage = {
  text: string;
};

export class OutboundService {
  constructor(
    private readonly evolution: EvolutionClient,
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {}

  async sendMany(params: {
    tenantId: string;
    instance: string;
    phone: string;
    messages: OutboundMessage[];
    meta?: Prisma.InputJsonValue;
  }): Promise<void> {
    for (const message of params.messages) {
      await this.evolution.sendText({
        instance: params.instance,
        phone: params.phone,
        text: message.text,
      });

      await this.prisma.messageLog.create({
        data: {
          tenantId: params.tenantId,
          phone: params.phone,
          direction: "outbound",
          body: message.text,
          meta: params.meta,
        },
      });

      this.logger.debug(
        { tenantId: params.tenantId, phone: params.phone },
        "outbound.sent",
      );
    }
  }
}
