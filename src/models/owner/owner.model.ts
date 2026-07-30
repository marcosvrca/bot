import type { PrismaClient } from "@prisma/client";
import { normalizePhone } from "../../core/messaging/evolution-client.js";
import type {
  BotModel,
  IncomingMessage,
  ModelContext,
  ModelResult,
} from "../types.js";
import { formatPriceBRL } from "../catalog/catalog.repository.js";
import { formatAppointment, formatDateTime } from "../scheduling/appointment.repository.js";

type Step =
  | "idle"
  | "add_name"
  | "add_price"
  | "add_category"
  | "del_pick";

type OwnerState = {
  step: Step;
  draftName?: string;
  draftPrice?: number;
  draftCategory?: string;
  candidates?: string[];
};

const EXIT = new Set(["sair", "exit", "encerrar"]);
const HOME = new Set(["menu", "admin", "inicio", "início", "0", "voltar"]);

/**
 * Painel no WhatsApp para o dono do negócio (ex.: fisioterapeuta só no celular).
 * Entrada: digitar *admin*
 */
export class OwnerModel implements BotModel {
  readonly id = "owner" as const;
  readonly capabilities = ["owner-admin", "mobile-ops"];

  constructor(private readonly prisma: PrismaClient) {}

  async onStart(ctx: ModelContext, message: IncomingMessage): Promise<ModelResult> {
    const text = message.text.trim().toLowerCase();
    if (text && !HOME.has(text) && text !== "admin") {
      return this.handleMessage(
        { ...ctx, sessionState: { step: "idle" } },
        message,
      );
    }
    return this.home();
  }

  async handleMessage(ctx: ModelContext, message: IncomingMessage): Promise<ModelResult> {
    const text = message.text.trim();
    const lower = text.toLowerCase();
    const state = (ctx.sessionState as OwnerState | undefined) ?? { step: "idle" };

    if (EXIT.has(lower)) {
      return {
        replies: [
          {
            text: "Painel do dono encerrado. Digite *admin* quando quiser voltar.",
          },
        ],
        nextState: {},
        endSession: true,
      };
    }

    if (HOME.has(lower)) {
      return this.home();
    }

    switch (state.step) {
      case "add_name":
        return this.onAddName(text);
      case "add_price":
        return this.onAddPrice(state, text);
      case "add_category":
        return this.onAddCategory(ctx, state, text);
      case "del_pick":
        return this.onDelPick(ctx, state, text);
      case "idle":
      default:
        return this.routeIdle(ctx, lower);
    }
  }

  private home(): ModelResult {
    return {
      replies: [
        {
          text: [
            "*🛠️ Painel do dono (WhatsApp)*",
            "Gerencie sem computador:",
            "",
            "*1* - Agenda de hoje",
            "*2* - Próximos compromissos",
            "*3* - Leads recentes",
            "*4* - Ver catálogo / preços",
            "*5* - Adicionar serviço",
            "*6* - Remover serviço",
            "",
            "_Digite *admin* para este menu · *sair* para encerrar._",
          ].join("\n"),
        },
      ],
      nextState: { step: "idle" } satisfies OwnerState,
    };
  }

  private async routeIdle(ctx: ModelContext, lower: string): Promise<ModelResult> {
    if (["1", "hoje", "agenda"].includes(lower)) {
      return this.listToday(ctx);
    }
    if (["2", "proximos", "próximos"].includes(lower)) {
      return this.listUpcoming(ctx);
    }
    if (["3", "leads", "crm"].includes(lower)) {
      return this.listLeads(ctx);
    }
    if (["4", "catalogo", "catálogo", "servicos", "serviços", "precos", "preços"].includes(lower)) {
      return this.listCatalog(ctx);
    }
    if (["5", "adicionar", "novo"].includes(lower)) {
      return {
        replies: [{ text: "Nome do *serviço* (ex.: Fisioterapia domiciliar 50min):" }],
        nextState: { step: "add_name" },
      };
    }
    if (["6", "remover", "apagar", "excluir"].includes(lower)) {
      return this.startDelete(ctx);
    }

    return {
      replies: [
        {
          text: `Não entendi.\n\n${(await this.home()).replies[0]?.text}`,
        },
      ],
      nextState: { step: "idle" },
    };
  }

  private async listToday(ctx: ModelContext): Promise<ModelResult> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const items = await this.prisma.appointment.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: ["scheduled", "confirmed"] },
        scheduledAt: { gte: start, lt: end },
      },
      orderBy: { scheduledAt: "asc" },
    });

    if (!items.length) {
      return {
        replies: [{ text: "Nenhum atendimento *hoje*." }],
        nextState: { step: "idle" },
      };
    }

    const body = items
      .map((a, i) => formatAppointment(a as never, i + 1))
      .join("\n\n");
    return {
      replies: [{ text: `*📅 Hoje (${items.length})*\n\n${body}` }],
      nextState: { step: "idle" },
    };
  }

  private async listUpcoming(ctx: ModelContext): Promise<ModelResult> {
    const now = new Date();
    const items = await this.prisma.appointment.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: ["scheduled", "confirmed"] },
        scheduledAt: { gte: now },
      },
      orderBy: { scheduledAt: "asc" },
      take: 15,
    });

    if (!items.length) {
      return {
        replies: [{ text: "Nenhum compromisso futuro." }],
        nextState: { step: "idle" },
      };
    }

    const body = items
      .map(
        (a, i) =>
          `*${i + 1}.* ${a.title}\n📞 ${a.phone}\n🗓 ${formatDateTime(a.scheduledAt)}\nStatus: ${a.status}`,
      )
      .join("\n\n");

    return {
      replies: [{ text: `*🗓️ Próximos*\n\n${body}` }],
      nextState: { step: "idle" },
    };
  }

  private async listLeads(ctx: ModelContext): Promise<ModelResult> {
    const items = await this.prisma.lead.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    if (!items.length) {
      return {
        replies: [{ text: "Nenhum lead ainda." }],
        nextState: { step: "idle" },
      };
    }
    const body = items
      .map(
        (l, i) =>
          `*${i + 1}.* ${l.name}\n📞 ${l.phone}\n💡 ${l.interest || "—"}\nStatus: ${l.status}`,
      )
      .join("\n\n");
    return {
      replies: [{ text: `*👥 Leads recentes*\n\n${body}` }],
      nextState: { step: "idle" },
    };
  }

  private async listCatalog(ctx: ModelContext): Promise<ModelResult> {
    const items = await this.prisma.catalogItem.findMany({
      where: { tenantId: ctx.tenantId, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    if (!items.length) {
      return {
        replies: [
          {
            text: "Catálogo vazio. Digite *5* para adicionar o primeiro serviço.",
          },
        ],
        nextState: { step: "idle" },
      };
    }
    const body = items
      .map(
        (item, i) =>
          `*${i + 1}.* ${item.name}\n💰 ${formatPriceBRL(item.priceCents)}${item.category ? `\n📁 ${item.category}` : ""}`,
      )
      .join("\n\n");
    return {
      replies: [{ text: `*🛒 Serviços / preços*\n\n${body}` }],
      nextState: { step: "idle" },
    };
  }

  private onAddName(text: string): ModelResult {
    if (text.trim().length < 2) {
      return {
        replies: [{ text: "Nome muito curto. Envie o nome do serviço:" }],
        nextState: { step: "add_name" },
      };
    }
    return {
      replies: [
        {
          text: "Preço em reais (ex.: `180` ou `180.50`):",
        },
      ],
      nextState: { step: "add_price", draftName: text.trim() },
    };
  }

  private onAddPrice(state: OwnerState, text: string): ModelResult {
    const normalized = text.replace(",", ".").replace(/[^\d.]/g, "");
    const value = Number(normalized);
    if (!Number.isFinite(value) || value < 0) {
      return {
        replies: [{ text: "Preço inválido. Ex.: `150` ou `150.00`" }],
        nextState: state,
      };
    }
    return {
      replies: [
        {
          text: "Categoria? (ex.: Domiciliar, Clínica) ou digite *pular*",
        },
      ],
      nextState: {
        step: "add_category",
        draftName: state.draftName,
        draftPrice: Math.round(value * 100),
      },
    };
  }

  private async onAddCategory(
    ctx: ModelContext,
    state: OwnerState,
    text: string,
  ): Promise<ModelResult> {
    const skip = ["pular", "skip", "-", "nao", "não"].includes(text.toLowerCase());
    const category = skip ? null : text.trim();
    if (!state.draftName || state.draftPrice === undefined) {
      return this.home();
    }

    const count = await this.prisma.catalogItem.count({
      where: { tenantId: ctx.tenantId },
    });

    const item = await this.prisma.catalogItem.create({
      data: {
        tenantId: ctx.tenantId,
        name: state.draftName,
        priceCents: state.draftPrice,
        category,
        active: true,
        sortOrder: count + 1,
      },
    });

    return {
      replies: [
        {
          text: [
            "✅ Serviço publicado no catálogo!",
            `*${item.name}*`,
            `💰 ${formatPriceBRL(item.priceCents)}`,
            category ? `📁 ${category}` : "",
            "",
            "Digite *admin* para o menu.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      nextState: { step: "idle" },
    };
  }

  private async startDelete(ctx: ModelContext): Promise<ModelResult> {
    const items = await this.prisma.catalogItem.findMany({
      where: { tenantId: ctx.tenantId, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    if (!items.length) {
      return {
        replies: [{ text: "Não há serviços para remover." }],
        nextState: { step: "idle" },
      };
    }
    const body = items
      .map((item, i) => `*${i + 1}.* ${item.name} — ${formatPriceBRL(item.priceCents)}`)
      .join("\n");
    return {
      replies: [
        {
          text: `Qual serviço remover?\n\n${body}\n\n_Digite o número ou *0* para cancelar._`,
        },
      ],
      nextState: {
        step: "del_pick",
        candidates: items.map((i) => i.id),
      },
    };
  }

  private async onDelPick(
    ctx: ModelContext,
    state: OwnerState,
    text: string,
  ): Promise<ModelResult> {
    if (text.trim() === "0") {
      return this.home();
    }
    const idx = Number(text.trim());
    const candidates = state.candidates ?? [];
    if (!Number.isInteger(idx) || idx < 1 || idx > candidates.length) {
      return {
        replies: [{ text: `Digite 1 a ${candidates.length}, ou *0*.` }],
        nextState: state,
      };
    }
    const id = candidates[idx - 1]!;
    const item = await this.prisma.catalogItem.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });
    if (!item) {
      return {
        replies: [{ text: "Item não encontrado." }],
        nextState: { step: "idle" },
      };
    }
    await this.prisma.catalogItem.update({
      where: { id },
      data: { active: false },
    });
    return {
      replies: [{ text: `🗑️ *${item.name}* removido do catálogo.` }],
      nextState: { step: "idle" },
    };
  }
}

/** Variantes BR: WhatsApp às vezes omite o 9º dígito (55+DDD+8 vs 55+DDD+9+8). */
export function phoneMatchKeys(raw: string): string[] {
  const n = normalizePhone(raw);
  const keys = new Set<string>([n]);
  if (n.startsWith("55") && n.length === 13) {
    keys.add(n.slice(0, 4) + n.slice(5));
  } else if (n.startsWith("55") && n.length === 12) {
    keys.add(n.slice(0, 4) + "9" + n.slice(4));
  }
  return [...keys];
}

export function isOwnerPhone(ownerPhones: string[] | undefined, phone: string): boolean {
  if (!ownerPhones?.length) return false;
  const incoming = new Set(phoneMatchKeys(phone));
  return ownerPhones.some((p) => phoneMatchKeys(p).some((k) => incoming.has(k)));
}
