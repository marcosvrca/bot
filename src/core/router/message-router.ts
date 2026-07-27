import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Logger } from "../../config/logger.js";
import type { OutboundService } from "../messaging/outbound-service.js";
import type { SessionStore } from "../session/session-store.js";
import { RateLimiter } from "../security/guards.js";
import type { ModelRegistry } from "../../models/registry.js";
import type { BotModelId, IncomingMessage } from "../../models/types.js";
import type { TenantService } from "../../tenants/tenant-service.js";

export class MessageRouter {
  private readonly rateLimiter: RateLimiter;

  constructor(
    private readonly tenants: TenantService,
    private readonly sessions: SessionStore,
    private readonly registry: ModelRegistry,
    private readonly outbound: OutboundService,
    private readonly prisma: PrismaClient,
    redis: Redis,
    private readonly logger: Logger,
  ) {
    this.rateLimiter = new RateLimiter(redis);
  }

  async handle(params: {
    instance: string;
    message: IncomingMessage;
  }): Promise<void> {
    const bundle = await this.tenants.findByInstance(params.instance);
    if (!bundle) {
      this.logger.warn({ instance: params.instance }, "router.tenant.not_found");
      return;
    }

    const { tenant, config } = bundle;
    const allowed = await this.rateLimiter.allow(tenant.id, params.message.phone);
    if (!allowed) {
      this.logger.warn(
        { tenantId: tenant.id, phone: params.message.phone },
        "router.rate_limited",
      );
      await this.outbound.sendMany({
        tenantId: tenant.id,
        instance: config.evolutionInstance,
        phone: params.message.phone,
        messages: [
          {
            text: "Você enviou muitas mensagens em pouco tempo. Aguarde um momento e tente novamente.",
          },
        ],
      });
      return;
    }

    await this.prisma.messageLog.create({
      data: {
        tenantId: tenant.id,
        phone: params.message.phone,
        direction: "inbound",
        body: params.message.text,
        meta: {
          messageType: params.message.messageType,
          pushName: params.message.pushName,
        },
      },
    });

    let session = await this.sessions.get(tenant.id, params.message.phone);
    const defaultModel = this.tenants.resolveDefaultModel(config);

    if (!session) {
      session = {
        tenantId: tenant.id,
        phone: params.message.phone,
        model: defaultModel,
        state: {},
      };
    }

    const modelId = (session.model as BotModelId) || defaultModel;
    if (!this.registry.has(modelId) || !config.activeModels.includes(modelId)) {
      session.model = defaultModel;
    }

    const model = this.registry.get(session.model as BotModelId);
    const ctx = {
      tenantId: tenant.id,
      instance: config.evolutionInstance,
      modelId: model.id,
      sessionState: session.state,
      menuFlow: config.menuFlow,
    };

    const isFresh = Object.keys(session.state).length === 0;
    const result = isFresh
      ? await model.onStart(ctx, params.message)
      : await model.handleMessage(ctx, params.message);

    if (result.endSession) {
      await this.sessions.clear(tenant.id, params.message.phone);
    } else {
      await this.sessions.save({
        tenantId: tenant.id,
        phone: params.message.phone,
        model: result.nextModel ?? model.id,
        state: result.nextState,
      });
    }

    if (result.replies.length > 0) {
      await this.outbound.sendMany({
        tenantId: tenant.id,
        instance: config.evolutionInstance,
        phone: params.message.phone,
        messages: result.replies,
      });
    }
  }
}
