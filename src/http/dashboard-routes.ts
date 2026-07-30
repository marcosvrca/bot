import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { webhookAuthHook } from "../core/security/webhook-auth.js";
import { LeadRepository } from "../models/leads/lead.repository.js";
import { CatalogRepository } from "../models/catalog/catalog.repository.js";
import type { OutboundService } from "../core/messaging/outbound-service.js";
import type { SessionStore } from "../core/session/session-store.js";
import type { EvolutionClient } from "../core/messaging/evolution-client.js";
import {
  AVAILABLE_MODELS,
  catalogItemSchema,
  configUpdateSchema,
  getDefaultMenuFlow,
  leadUpdateSchema,
  menuFlowSchema,
  priceToCents,
  toMenuFlowJson,
} from "./admin-schemas.js";
import { DashboardService } from "./dashboard-service.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

const replySchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

const takeoverSchema = z.object({
  enabled: z.boolean(),
});

export async function registerDashboardRoutes(
  app: FastifyInstance,
  deps: {
    prisma: PrismaClient;
    outbound: OutboundService;
    sessions: SessionStore;
    evolution: EvolutionClient;
  },
): Promise<void> {
  const dashboard = new DashboardService(deps.prisma);
  const leads = new LeadRepository(deps.prisma);
  const catalog = new CatalogRepository(deps.prisma);
  const staticRoot = path.join(process.cwd(), "public", "dashboard");

  app.get("/dashboard", async (_request, reply) => {
    const index = path.join(staticRoot, "index.html");
    if (!existsSync(index)) {
      return reply.code(404).send({ error: "dashboard_not_found" });
    }
    return reply.type("text/html; charset=utf-8").send(createReadStream(index));
  });

  app.get("/dashboard/*", async (request, reply) => {
    const suffix = (request.params as { "*": string })["*"] || "index.html";
    const safe = path.normalize(suffix).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(staticRoot, safe);
    if (!filePath.startsWith(staticRoot) || !existsSync(filePath)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const ext = path.extname(filePath);
    return reply.type(MIME[ext] ?? "application/octet-stream").send(createReadStream(filePath));
  });

  app.get(
    "/api/dashboard/:slug/overview",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const data = await dashboard.overview(tenant.id);
      return reply.send({
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          activeModels: tenant.config?.activeModels ?? [],
          defaultModel: tenant.config?.defaultModel ?? "menu",
          instance: tenant.config?.evolutionInstance ?? null,
        },
        ...data,
      });
    },
  );

  app.get(
    "/api/dashboard/:slug/messages",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const query = request.query as { limit?: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const limit = query.limit ? Number(query.limit) : 50;
      const items = await dashboard.messages(tenant.id, Number.isFinite(limit) ? limit : 50);
      return reply.send({ count: items.length, messages: items });
    },
  );

  app.get(
    "/api/dashboard/:slug/conversations",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const query = request.query as { limit?: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const limit = query.limit ? Number(query.limit) : 40;
      const items = await dashboard.conversations(
        tenant.id,
        Number.isFinite(limit) ? limit : 40,
      );
      return reply.send({ count: items.length, conversations: items });
    },
  );

  app.get(
    "/api/dashboard/:slug/conversations/:phone",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug, phone } = request.params as { slug: string; phone: string };
      const query = request.query as { limit?: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const limit = query.limit ? Number(query.limit) : 120;
      const thread = await dashboard.thread(
        tenant.id,
        decodeURIComponent(phone),
        Number.isFinite(limit) ? limit : 120,
      );
      return reply.send(thread);
    },
  );

  app.post(
    "/api/dashboard/:slug/conversations/:phone/reply",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug, phone: rawPhone } = request.params as { slug: string; phone: string };
      const parsed = replySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }

      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant?.config?.evolutionInstance) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }

      const phone = decodeURIComponent(rawPhone);
      const defaultModel = tenant.config.defaultModel || "menu";
      const existing = await deps.sessions.get(tenant.id, phone);

      await deps.sessions.save({
        tenantId: tenant.id,
        phone,
        model: existing?.model ?? defaultModel,
        state: {
          ...(existing?.state ?? {}),
          humanTakeover: true,
          takenOverAt: new Date().toISOString(),
        },
      });

      await deps.outbound.sendMany({
        tenantId: tenant.id,
        instance: tenant.config.evolutionInstance,
        phone,
        messages: [{ text: parsed.data.text }],
        meta: { source: "dashboard" },
      });

      const thread = await dashboard.thread(tenant.id, phone);
      return reply.send({ ok: true, humanTakeover: true, thread });
    },
  );

  app.post(
    "/api/dashboard/:slug/conversations/:phone/takeover",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug, phone: rawPhone } = request.params as { slug: string; phone: string };
      const parsed = takeoverSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }

      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }

      const phone = decodeURIComponent(rawPhone);
      const defaultModel = tenant.config?.defaultModel || "menu";
      const existing = await deps.sessions.get(tenant.id, phone);
      const nextState = { ...(existing?.state ?? {}) };

      if (parsed.data.enabled) {
        nextState.humanTakeover = true;
        nextState.takenOverAt = new Date().toISOString();
      } else {
        delete nextState.humanTakeover;
        delete nextState.takenOverAt;
        delete nextState.lastInboundAt;
      }

      await deps.sessions.save({
        tenantId: tenant.id,
        phone,
        model: existing?.model ?? defaultModel,
        state: nextState,
      });

      return reply.send({
        ok: true,
        phone,
        humanTakeover: parsed.data.enabled,
      });
    },
  );

  app.get(
    "/api/dashboard/:slug/appointments",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const query = request.query as { limit?: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const limit = query.limit ? Number(query.limit) : 50;
      const items = await dashboard.appointments(
        tenant.id,
        Number.isFinite(limit) ? limit : 50,
      );
      return reply.send({ count: items.length, appointments: items });
    },
  );

  app.get(
    "/api/dashboard/:slug/leads",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const query = request.query as { limit?: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const limit = query.limit ? Number(query.limit) : 50;
      const items = await leads.listByTenant(tenant.id, Number.isFinite(limit) ? limit : 50);
      return reply.send({ count: items.length, leads: items });
    },
  );

  app.get(
    "/api/dashboard/:slug/catalog",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const query = request.query as { all?: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const items =
        query.all === "1"
          ? await catalog.listAll(tenant.id, 200)
          : await catalog.listActive(tenant.id, 100);
      return reply.send({ count: items.length, items });
    },
  );

  app.post(
    "/api/dashboard/:slug/catalog",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const parsed = catalogItemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const item = await catalog.create({
        tenantId: tenant.id,
        name: parsed.data.name,
        description: parsed.data.description,
        priceCents: priceToCents(parsed.data.price),
        sku: parsed.data.sku,
        category: parsed.data.category,
        sortOrder: parsed.data.sortOrder,
        active: parsed.data.active,
      });
      return reply.code(201).send({ item });
    },
  );

  app.put(
    "/api/dashboard/:slug/catalog/:id",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug, id } = request.params as { slug: string; id: string };
      const parsed = catalogItemSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const item = await catalog.update(tenant.id, id, {
        name: parsed.data.name,
        description: parsed.data.description,
        priceCents:
          parsed.data.price === undefined ? undefined : priceToCents(parsed.data.price),
        sku: parsed.data.sku,
        category: parsed.data.category,
        sortOrder: parsed.data.sortOrder,
        active: parsed.data.active,
      });
      if (!item) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.send({ item });
    },
  );

  app.delete(
    "/api/dashboard/:slug/catalog/:id",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug, id } = request.params as { slug: string; id: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const ok = await catalog.remove(tenant.id, id);
      if (!ok) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.send({ ok: true });
    },
  );

  app.get(
    "/api/dashboard/:slug/menu",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const flow = tenant.config?.menuFlow ?? getDefaultMenuFlow();
      return reply.send({ menuFlow: flow, defaultMenuFlow: getDefaultMenuFlow() });
    },
  );

  app.put(
    "/api/dashboard/:slug/menu",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const parsed = menuFlowSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_menu", details: parsed.error.flatten() });
      }
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant?.config) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      await deps.prisma.tenantConfig.update({
        where: { tenantId: tenant.id },
        data: { menuFlow: toMenuFlowJson(parsed.data) },
      });
      return reply.send({ ok: true, menuFlow: parsed.data });
    },
  );

  app.post(
    "/api/dashboard/:slug/menu/reset",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant?.config) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const flow = getDefaultMenuFlow();
      await deps.prisma.tenantConfig.update({
        where: { tenantId: tenant.id },
        data: { menuFlow: toMenuFlowJson(flow) },
      });
      return reply.send({ ok: true, menuFlow: flow });
    },
  );

  app.get(
    "/api/dashboard/:slug/settings",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant?.config) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      return reply.send({
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          active: tenant.active,
        },
        config: {
          evolutionInstance: tenant.config.evolutionInstance,
          defaultModel: tenant.config.defaultModel,
          activeModels: tenant.config.activeModels,
          leadsWebhookUrl: tenant.config.leadsWebhookUrl,
          ownerPhones: tenant.config.ownerPhones,
        },
        availableModels: AVAILABLE_MODELS,
      });
    },
  );

  app.put(
    "/api/dashboard/:slug/settings",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const parsed = configUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant?.config) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }

      if (parsed.data.name) {
        await deps.prisma.tenant.update({
          where: { id: tenant.id },
          data: { name: parsed.data.name },
        });
      }

      const activeModels = parsed.data.activeModels ?? tenant.config.activeModels;
      const defaultModel = parsed.data.defaultModel ?? tenant.config.defaultModel;
      if (!activeModels.includes(defaultModel)) {
        return reply.code(400).send({
          error: "default_model_not_active",
          message: "O modelo padrão precisa estar entre os modelos ativos.",
        });
      }

      const leadsWebhookUrl =
        parsed.data.leadsWebhookUrl === undefined
          ? undefined
          : parsed.data.leadsWebhookUrl === "" || parsed.data.leadsWebhookUrl === null
            ? null
            : parsed.data.leadsWebhookUrl;

      const ownerPhones =
        parsed.data.ownerPhones === undefined
          ? undefined
          : parsed.data.ownerPhones.map((p) => p.replace(/\D/g, "")).filter(Boolean);

      await deps.prisma.tenantConfig.update({
        where: { tenantId: tenant.id },
        data: {
          defaultModel,
          activeModels,
          ...(leadsWebhookUrl !== undefined ? { leadsWebhookUrl } : {}),
          ...(ownerPhones !== undefined ? { ownerPhones } : {}),
        },
      });

      const refreshed = await dashboard.resolveTenant(slug);
      return reply.send({
        ok: true,
        tenant: {
          id: refreshed!.id,
          name: refreshed!.name,
          slug: refreshed!.slug,
        },
        config: {
          evolutionInstance: refreshed!.config!.evolutionInstance,
          defaultModel: refreshed!.config!.defaultModel,
          activeModels: refreshed!.config!.activeModels,
          leadsWebhookUrl: refreshed!.config!.leadsWebhookUrl,
          ownerPhones: refreshed!.config!.ownerPhones,
        },
      });
    },
  );

  app.put(
    "/api/dashboard/:slug/leads/:id",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug, id } = request.params as { slug: string; id: string };
      const parsed = leadUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const data = {
        ...parsed.data,
        email:
          parsed.data.email === "" || parsed.data.email === undefined
            ? parsed.data.email === ""
              ? null
              : undefined
            : parsed.data.email,
      };
      const item = await leads.update(tenant.id, id, data);
      if (!item) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.send({ lead: item });
    },
  );

  app.delete(
    "/api/dashboard/:slug/leads/:id",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug, id } = request.params as { slug: string; id: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const ok = await leads.remove(tenant.id, id);
      if (!ok) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/api/dashboard/:slug/appointments/:id/cancel",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug, id } = request.params as { slug: string; id: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      const existing = await deps.prisma.appointment.findFirst({
        where: { id, tenantId: tenant.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "not_found" });
      }
      const item = await deps.prisma.appointment.update({
        where: { id },
        data: { status: "cancelled" },
      });
      return reply.send({ appointment: item });
    },
  );

  app.get(
    "/api/dashboard/:slug/channel",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant?.config?.evolutionInstance) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      try {
        const status = await deps.evolution.fetchInstanceInfo(
          tenant.config.evolutionInstance,
        );
        return reply.send(status);
      } catch (err) {
        return reply.code(502).send({
          error: "evolution_unavailable",
          message: err instanceof Error ? err.message : "Evolution indisponível",
        });
      }
    },
  );

  app.post(
    "/api/dashboard/:slug/channel/connect",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant?.config?.evolutionInstance) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      try {
        const result = await deps.evolution.ensureConnectedWithQr(
          tenant.config.evolutionInstance,
        );
        return reply.send(result);
      } catch (err) {
        return reply.code(502).send({
          error: "evolution_connect_failed",
          message: err instanceof Error ? err.message : "Falha ao conectar canal",
        });
      }
    },
  );

  app.post(
    "/api/dashboard/:slug/channel/logout",
    { preHandler: webhookAuthHook },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const tenant = await dashboard.resolveTenant(slug);
      if (!tenant?.config?.evolutionInstance) {
        return reply.code(404).send({ error: "tenant_not_found" });
      }
      try {
        await deps.evolution.logout(tenant.config.evolutionInstance);
        const status = await deps.evolution.fetchInstanceInfo(
          tenant.config.evolutionInstance,
        );
        return reply.send({ ok: true, ...status });
      } catch (err) {
        return reply.code(502).send({
          error: "evolution_logout_failed",
          message: err instanceof Error ? err.message : "Falha ao desconectar",
        });
      }
    },
  );
}
