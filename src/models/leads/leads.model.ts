import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../../config/logger.js";
import type {
  BotModel,
  IncomingMessage,
  ModelContext,
  ModelResult,
} from "../types.js";
import { formatLeadSummary, LeadRepository } from "./lead.repository.js";
import { notifyLeadWebhook } from "./leads.notify.js";
import { isSkip, parseEmail, parseRequiredText } from "./leads.parse.js";

type Step = "name" | "email" | "interest" | "city" | "confirm";

type LeadsState = {
  step: Step;
  name?: string;
  email?: string | null;
  interest?: string | null;
  city?: string | null;
  origin?: string;
};

const EXIT = new Set(["sair", "exit", "cancelar", "encerrar"]);
const MENU = new Set(["menu", "inicio", "início", "voltar", "0"]);
const HELP = new Set(["ajuda", "help", "?"]);

export class LeadsModel implements BotModel {
  readonly id = "leads" as const;
  readonly capabilities = ["lead-capture", "crm", "webhook"];

  private readonly repo: LeadRepository;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {
    this.repo = new LeadRepository(prisma);
  }

  async onStart(ctx: ModelContext, _message: IncomingMessage): Promise<ModelResult> {
    const seed = ctx.sessionState as Partial<LeadsState>;
    const interest = seed.interest ?? null;
    const origin = seed.origin ?? "whatsapp";

    if (interest) {
      return {
        replies: [
          {
            text: [
              "Vou registrar seu contato para a equipe comercial.",
              `Interesse: *${interest}*`,
              "",
              "Qual o seu *nome completo*?",
              "",
              "_Digite *pular* nos campos opcionais, *menu* para voltar ou *sair* para encerrar._",
            ].join("\n"),
          },
        ],
        nextState: { step: "name", interest, origin } satisfies LeadsState,
      };
    }

    return {
      replies: [
        {
          text: [
            "Vou registrar seu contato para a equipe comercial.",
            "",
            "Qual o seu *nome completo*?",
            "",
            "_Digite *pular* nos campos opcionais, *menu* para voltar ou *sair* para encerrar._",
          ].join("\n"),
        },
      ],
      nextState: { step: "name", origin } satisfies LeadsState,
    };
  }

  async handleMessage(ctx: ModelContext, message: IncomingMessage): Promise<ModelResult> {
    const text = message.text.trim();
    const lower = text.toLowerCase();
    const state = (ctx.sessionState as LeadsState | undefined) ?? {
      step: "name" as const,
      origin: "whatsapp",
    };

    if (EXIT.has(lower)) {
      return {
        replies: [
          {
            text: "Cadastro cancelado. Envie *modelo leads* ou *menu* quando quiser retomar.",
          },
        ],
        nextState: {},
        endSession: true,
      };
    }

    if (MENU.has(lower)) {
      return {
        replies: [{ text: "Voltando ao menu…" }],
        nextState: {},
        nextModel: "menu",
      };
    }

    if (HELP.has(lower)) {
      return this.help(state);
    }

    switch (state.step) {
      case "name":
        return this.onName(state, text);
      case "email":
        return this.onEmail(state, text);
      case "interest":
        return this.onInterest(state, text);
      case "city":
        return this.onCity(state, text);
      case "confirm":
        return this.onConfirm(ctx, state, message, lower);
      default:
        return this.onStart(ctx, message);
    }
  }

  private help(state: LeadsState): ModelResult {
    return {
      replies: [
        {
          text: [
            "*Ajuda — Captura de leads*",
            "Coletamos nome, e-mail, interesse e cidade.",
            "Campos opcionais: digite *pular*.",
            "Confirmação: *sim* para salvar, *não* para recomeçar.",
            "",
            this.promptFor(state.step, state),
          ].join("\n"),
        },
      ],
      nextState: state,
    };
  }

  private onName(state: LeadsState, text: string): ModelResult {
    const name = parseRequiredText(text, 2, 80);
    if (!name) {
      return {
        replies: [{ text: "Nome inválido. Envie seu *nome completo* (pelo menos 2 caracteres)." }],
        nextState: state,
      };
    }
    const next: LeadsState = { ...state, name, step: "email" };
    return {
      replies: [
        {
          text: "Qual o seu *e-mail*?\n_(Ou digite *pular*)_",
        },
      ],
      nextState: next,
    };
  }

  private onEmail(state: LeadsState, text: string): ModelResult {
    let email: string | null = null;
    if (!isSkip(text)) {
      email = parseEmail(text);
      if (!email) {
        return {
          replies: [
            {
              text: "E-mail inválido. Envie um e-mail válido ou digite *pular*.",
            },
          ],
          nextState: state,
        };
      }
    }

    const next: LeadsState = { ...state, email, step: "interest" };
    if (state.interest) {
      return this.askCity({ ...next, step: "city" });
    }
    return {
      replies: [
        {
          text: "Qual o seu *interesse* ou serviço desejado?\n_(Ou digite *pular*)_",
        },
      ],
      nextState: next,
    };
  }

  private onInterest(state: LeadsState, text: string): ModelResult {
    const interest = isSkip(text) ? null : parseRequiredText(text, 2, 120);
    if (!isSkip(text) && !interest) {
      return {
        replies: [
          {
            text: "Interesse inválido. Descreva em poucas palavras ou digite *pular*.",
          },
        ],
        nextState: state,
      };
    }
    return this.askCity({ ...state, interest, step: "city" });
  }

  private askCity(state: LeadsState): ModelResult {
    return {
      replies: [
        {
          text: "Qual a sua *cidade*?\n_(Ou digite *pular*)_",
        },
      ],
      nextState: state,
    };
  }

  private onCity(state: LeadsState, text: string): ModelResult {
    const city = isSkip(text) ? null : parseRequiredText(text, 2, 80);
    if (!isSkip(text) && !city) {
      return {
        replies: [
          {
            text: "Cidade inválida. Envie o nome da cidade ou digite *pular*.",
          },
        ],
        nextState: state,
      };
    }
    const next: LeadsState = { ...state, city, step: "confirm" };
    return {
      replies: [{ text: this.confirmText(next) }],
      nextState: next,
    };
  }

  private async onConfirm(
    ctx: ModelContext,
    state: LeadsState,
    message: IncomingMessage,
    lower: string,
  ): Promise<ModelResult> {
    if (["nao", "não", "n", "corrigir", "recomeçar", "recomecar"].includes(lower)) {
      return this.onStart(
        { ...ctx, sessionState: { interest: state.interest, origin: state.origin } },
        message,
      );
    }

    if (!["sim", "s", "confirmar", "ok", "1"].includes(lower)) {
      return {
        replies: [
          {
            text: `${this.confirmText(state)}\n\nResponda *sim* para salvar ou *não* para recomeçar.`,
          },
        ],
        nextState: state,
      };
    }

    if (!state.name) {
      return this.onStart(ctx, message);
    }

    const lead = await this.repo.create({
      tenantId: ctx.tenantId,
      phone: message.phone,
      name: state.name,
      email: state.email ?? null,
      interest: state.interest ?? null,
      city: state.city ?? null,
      origin: state.origin ?? "whatsapp",
      meta: { pushName: message.pushName, instance: ctx.instance },
    });

    const config = await this.prisma.tenantConfig.findUnique({
      where: { tenantId: ctx.tenantId },
      include: { tenant: true },
    });

    await notifyLeadWebhook({
      url: config?.leadsWebhookUrl,
      lead,
      tenantSlug: config?.tenant.slug,
      logger: this.logger,
    });

    this.logger.info(
      { tenantId: ctx.tenantId, leadId: lead.id, phone: lead.phone },
      "leads.created",
    );

    return {
      replies: [
        {
          text: [
            "Cadastro salvo com sucesso!",
            "",
            formatLeadSummary(lead),
            "",
            "Nossa equipe entrará em contato em breve.",
            "Digite *menu* para voltar ao início.",
          ].join("\n"),
        },
      ],
      nextState: {},
      nextModel: "menu",
    };
  }

  private confirmText(state: LeadsState): string {
    return [
      "*Confira os dados:*",
      `Nome: ${state.name ?? "-"}`,
      `E-mail: ${state.email ?? "(não informado)"}`,
      `Interesse: ${state.interest ?? "(não informado)"}`,
      `Cidade: ${state.city ?? "(não informado)"}`,
      "",
      "Confirma o cadastro? (*sim* / *não*)",
    ].join("\n");
  }

  private promptFor(step: Step, state: LeadsState): string {
    switch (step) {
      case "name":
        return "Qual o seu *nome completo*?";
      case "email":
        return "Qual o seu *e-mail*? _(ou *pular*)_";
      case "interest":
        return state.interest
          ? `Interesse já definido: *${state.interest}*`
          : "Qual o seu *interesse*? _(ou *pular*)_";
      case "city":
        return "Qual a sua *cidade*? _(ou *pular*)_";
      case "confirm":
        return this.confirmText(state);
    }
  }
}
