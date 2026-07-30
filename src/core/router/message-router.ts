import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Logger } from "../../config/logger.js";
import type { OutboundService } from "../messaging/outbound-service.js";
import type { SessionStore } from "../session/session-store.js";
import { RateLimiter } from "../security/guards.js";
import type { ModelRegistry } from "../../models/registry.js";
import type { BotModelId, IncomingMessage, ModelResult } from "../../models/types.js";
import type { TenantService } from "../../tenants/tenant-service.js";
import { isOwnerPhone } from "../../models/owner/owner.model.js";

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

    // Atendimento humano pelo dashboard: só registra a mensagem, não responde com o bot.
    if (session.state?.humanTakeover === true) {
      this.logger.info(
        { tenantId: tenant.id, phone: params.message.phone },
        "router.human_takeover.skip_bot",
      );
      await this.sessions.save({
        ...session,
        state: {
          ...session.state,
          lastInboundAt: new Date().toISOString(),
        },
      });
      return;
    }

    const owner = isOwnerPhone(config.ownerPhones, params.message.phone);
    const lowerText = params.message.text.trim().toLowerCase();
    if (
      owner &&
      ["admin", "painel", "/admin", "modelo admin", "modelo owner"].includes(lowerText)
    ) {
      session = {
        tenantId: tenant.id,
        phone: params.message.phone,
        model: "owner",
        state: {},
      };
      await this.sessions.save(session);
      params.message = { ...params.message, text: "admin" };
    }

    const switchTo = resolveModelSwitch(params.message.text, config.activeModels);
    if (switchTo) {
      session = {
        tenantId: tenant.id,
        phone: params.message.phone,
        model: switchTo,
        state: {},
      };
      await this.sessions.save(session);
      params.message = { ...params.message, text: "menu" };
    }

    let modelId = (session.model as BotModelId) || defaultModel;
    if (modelId === "owner") {
      if (!owner) {
        modelId = defaultModel;
        session.model = defaultModel;
      }
    } else if (!this.registry.has(modelId) || !config.activeModels.includes(modelId)) {
      modelId = defaultModel;
      session.model = defaultModel;
    }

    const model = this.registry.get(modelId);
    const ctx = {
      tenantId: tenant.id,
      instance: config.evolutionInstance,
      modelId: model.id,
      sessionState: session.state,
      menuFlow: config.menuFlow,
    };

    const isFresh = Object.keys(session.state).length === 0;
    let result = isFresh
      ? await model.onStart(ctx, params.message)
      : await model.handleMessage(ctx, params.message);

    result = await this.chainModelHandoff(result, model.id, config.activeModels, {
      tenantId: tenant.id,
      instance: config.evolutionInstance,
      menuFlow: config.menuFlow,
      message: params.message,
    });

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

  /** Quando um modelo pede `nextModel`, inicia o destino na mesma mensagem (Menu → Leads etc.). */
  private async chainModelHandoff(
    result: ModelResult,
    currentModelId: BotModelId,
    activeModels: string[],
    params: {
      tenantId: string;
      instance: string;
      menuFlow: unknown;
      message: IncomingMessage;
    },
  ): Promise<ModelResult> {
    const nextId = result.nextModel;
    if (!nextId || nextId === currentModelId || result.endSession) {
      return result;
    }
    if (!this.registry.has(nextId) || !activeModels.includes(nextId)) {
      this.logger.warn(
        { from: currentModelId, to: nextId, activeModels },
        "router.handoff.model_unavailable",
      );
      return {
        replies: [
          ...result.replies,
          {
            text: "Este serviço não está disponível neste atendimento. Digite *menu* para outras opções.",
          },
        ],
        nextState: {},
        nextModel: "menu",
      };
    }

    const next = this.registry.get(nextId);
    const start = await next.onStart(
      {
        tenantId: params.tenantId,
        instance: params.instance,
        modelId: next.id,
        sessionState: result.nextState,
        menuFlow: params.menuFlow,
      },
      params.message,
    );

    return {
      replies: [...result.replies, ...start.replies],
      nextState: start.nextState,
      nextModel: start.nextModel ?? nextId,
      endSession: start.endSession,
    };
  }
}

function resolveModelSwitch(text: string, activeModels: string[]): BotModelId | null {
  const normalized = text.trim().toLowerCase();
  const aliases: Record<string, BotModelId> = {
    "modelo menu": "menu",
    "bot menu": "menu",
    "/menu": "menu",
    "modelo agenda": "scheduling",
    "modelo agendamento": "scheduling",
    "bot agenda": "scheduling",
    "/agenda": "scheduling",
    "/agendamento": "scheduling",
    "modelo agenda google": "scheduling-google",
    "modelo agendamento google": "scheduling-google",
    "bot agenda google": "scheduling-google",
    "/agenda-google": "scheduling-google",
    "/agendamento-google": "scheduling-google",
    "modelo clinica": "clinic",
    "modelo clínica": "clinic",
    "bot clinica": "clinic",
    "bot clínica": "clinic",
    "/clinica": "clinic",
    "/clínica": "clinic",
    "modelo leads": "leads",
    "modelo lead": "leads",
    "modelo crm": "leads",
    "bot leads": "leads",
    "bot crm": "leads",
    "/leads": "leads",
    "/crm": "leads",
    "modelo catalogo": "catalog",
    "modelo catálogo": "catalog",
    "bot catalogo": "catalog",
    "bot catálogo": "catalog",
    "/catalogo": "catalog",
    "/catálogo": "catalog",
    "/catalog": "catalog",
  };
  const target = aliases[normalized];
  if (!target || !activeModels.includes(target)) {
    return null;
  }
  return target;
}
