import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { defaultMenuFlow, type MenuFlow } from "../models/menu/menu.flows.js";

export const AVAILABLE_MODELS = [
  "menu",
  "leads",
  "catalog",
  "scheduling",
  "scheduling-google",
  "clinic",
] as const;

const menuOptionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  next: z.string().min(1),
});

const menuNodeSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("menu"),
    title: z.string().min(1),
    body: z.string().optional(),
    options: z.array(menuOptionSchema).min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("message"),
    title: z.string().min(1),
    body: z.string().min(1),
    next: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("handoff"),
    title: z.string().min(1),
    body: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("model"),
    title: z.string().min(1),
    body: z.string().optional(),
    model: z.string().min(1),
    seed: z.record(z.unknown()).optional(),
  }),
]);

export const menuFlowSchema = z
  .object({
    start: z.string().min(1),
    nodes: z.record(menuNodeSchema),
  })
  .superRefine((flow, ctx) => {
    if (!flow.nodes[flow.start]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `start "${flow.start}" não existe em nodes`,
        path: ["start"],
      });
    }
    for (const [id, node] of Object.entries(flow.nodes)) {
      if (node.id !== id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `node.id deve ser igual à chave (${id})`,
          path: ["nodes", id, "id"],
        });
      }
    }
  });

export const configUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  defaultModel: z.enum(AVAILABLE_MODELS).optional(),
  activeModels: z.array(z.enum(AVAILABLE_MODELS)).min(1).optional(),
  leadsWebhookUrl: z
    .union([z.string().url(), z.literal(""), z.null()])
    .optional(),
  ownerPhones: z.array(z.string().min(8).max(20)).max(10).optional(),
});

export const catalogItemSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  /** Preço em reais (ex.: 489.9) — convertido para centavos no servidor. */
  price: z.coerce.number().nonnegative(),
  sku: z.string().trim().max(60).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  sortOrder: z.coerce.number().int().optional(),
  active: z.boolean().optional(),
});

export const leadUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().optional().nullable().or(z.literal("")),
  interest: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  status: z.enum(["new", "contacted", "qualified", "won", "lost"]).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export function toMenuFlowJson(flow: MenuFlow): Prisma.InputJsonValue {
  return flow as unknown as Prisma.InputJsonValue;
}

export function getDefaultMenuFlow(): MenuFlow {
  return structuredClone(defaultMenuFlow);
}

export function priceToCents(price: number): number {
  return Math.round(price * 100);
}
