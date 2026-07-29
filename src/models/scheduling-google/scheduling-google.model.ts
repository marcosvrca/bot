import type { PrismaClient } from "@prisma/client";
import type {
  BotModel,
  IncomingMessage,
  ModelContext,
  ModelResult,
} from "../types.js";
import {
  GoogleAppointmentRepository,
  formatAppointment,
  formatDateTime,
  formatReminderLabel,
} from "./appointment.repository.js";
import { parseDateTime, parseReminderMinutes } from "./scheduling.parse.js";

type Step =
  | "idle"
  | "create_title"
  | "create_when"
  | "create_reminder"
  | "create_description"
  | "create_confirm"
  | "edit_query"
  | "edit_pick"
  | "edit_field"
  | "edit_value"
  | "cancel_query"
  | "cancel_pick"
  | "cancel_confirm";

type Draft = {
  title?: string;
  scheduledAt?: string;
  remindBeforeMinutes?: number;
  description?: string | null;
};

type SchedulingState = {
  step: Step;
  draft?: Draft;
  candidates?: string[];
  selectedId?: string;
  editField?: "title" | "when" | "reminder" | "description";
};

const EXIT = new Set(["sair", "exit", "cancelar fluxo", "encerrar"]);
const HELP = new Set(["ajuda", "help", "?"]);
const MENU_CMDS = new Set(["menu", "inicio", "início", "voltar", "0"]);
const SKIP = new Set(["pular", "skip", "-", "nao", "não", "n", "sem"]);

export class SchedulingGoogleModel implements BotModel {
  readonly id = "scheduling-google" as const;
  readonly capabilities = [
    "appointments",
    "reminders",
    "report",
    "edit",
    "cancel",
    "google-calendar",
  ];

  private readonly prisma: PrismaClient;
  private repo: GoogleAppointmentRepository | null = null;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private getRepo(): GoogleAppointmentRepository {
    if (!this.repo) {
      this.repo = new GoogleAppointmentRepository(this.prisma);
    }
    return this.repo;
  }

  async onStart(ctx: ModelContext, message: IncomingMessage): Promise<ModelResult> {
    const text = message.text.trim().toLowerCase();
    if (text && !MENU_CMDS.has(text) && !HELP.has(text)) {
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
    const state = (ctx.sessionState as SchedulingState) ?? { step: "idle" };

    if (EXIT.has(lower)) {
      return {
        replies: [
          {
            text: "Agenda Google encerrada. Envie *modelo agenda google* para voltar.",
          },
        ],
        nextState: {},
        endSession: true,
      };
    }

    if (HELP.has(lower) || MENU_CMDS.has(lower)) {
      return this.home();
    }

    switch (state.step) {
      case "create_title":
        return this.stepCreateTitle(text);
      case "create_when":
        return this.stepCreateWhen(state, text);
      case "create_reminder":
        return this.stepCreateReminder(state, text);
      case "create_description":
        return this.stepCreateDescription(state, text);
      case "create_confirm":
        return this.stepCreateConfirm(ctx, message.phone, state, lower);
      case "edit_query":
        return this.stepQuery(ctx, message.phone, text, "edit");
      case "edit_pick":
        return this.stepPick(state, text, "edit");
      case "edit_field":
        return this.stepEditField(state, lower);
      case "edit_value":
        return this.stepEditValue(ctx, message.phone, state, text);
      case "cancel_query":
        return this.stepQuery(ctx, message.phone, text, "cancel");
      case "cancel_pick":
        return this.stepPick(state, text, "cancel");
      case "cancel_confirm":
        return this.stepCancelConfirm(ctx, message.phone, state, lower);
      case "idle":
      default:
        return this.routeIdle(ctx, message.phone, text, lower);
    }
  }

  private home(): ModelResult {
    return {
      replies: [
        {
          text: [
            "*📅 Agenda + Google Calendar*",
            "",
            "Compromissos criados aqui vão para o *Google Agenda*.",
            "",
            "Escolha uma opção:",
            "*1* - Novo compromisso",
            "*2* - Meus compromissos (relatório)",
            "*3* - Editar compromisso",
            "*4* - Cancelar compromisso",
            "*5* - Próximos 7 dias",
            "",
            "_Digite *ajuda* a qualquer momento. *sair* encerra._",
            "_Trocar de bot: *modelo menu*_ ",
          ].join("\n"),
        },
      ],
      nextState: { step: "idle" } satisfies SchedulingState,
    };
  }

  private async routeIdle(
    ctx: ModelContext,
    phone: string,
    text: string,
    lower: string,
  ): Promise<ModelResult> {
    if (["1", "novo", "criar", "agendar", "compromisso"].includes(lower)) {
      return {
        replies: [{ text: "Qual o *título* do compromisso?" }],
        nextState: { step: "create_title", draft: {} },
      };
    }
    if (["2", "lista", "listar", "relatorio", "relatório", "compromissos"].includes(lower)) {
      return this.listReport(ctx, phone);
    }
    if (["3", "editar", "alterar"].includes(lower)) {
      return {
        replies: [
          {
            text: "Envie o *título* ou a *data/hora* do compromisso que deseja editar.\nEx.: `Reunião` ou `28/07/2026 14:30`",
          },
        ],
        nextState: { step: "edit_query" },
      };
    }
    if (["4", "cancelar", "remover", "excluir"].includes(lower)) {
      return {
        replies: [
          {
            text: "Envie o *título* ou a *data/hora* do compromisso que deseja cancelar.",
          },
        ],
        nextState: { step: "cancel_query" },
      };
    }
    if (["5", "proximos", "próximos", "semana"].includes(lower)) {
      return this.listUpcomingWeek(ctx, phone);
    }

    if (text.length > 0) {
      return {
        replies: [
          {
            text: `Não entendi "${text}".\n\n${(await this.home()).replies[0]?.text}`,
          },
        ],
        nextState: { step: "idle" },
      };
    }
    return this.home();
  }

  private stepCreateTitle(text: string): ModelResult {
    if (text.length < 2) {
      return {
        replies: [{ text: "Título muito curto. Digite novamente o título:" }],
        nextState: { step: "create_title", draft: {} },
      };
    }
    return {
      replies: [
        {
          text: [
            "Quando é o compromisso?",
            "Exemplos:",
            "• `28/07/2026 14:30`",
            "• `hoje 15:00`",
            "• `amanhã 09:30`",
          ].join("\n"),
        },
      ],
      nextState: {
        step: "create_when",
        draft: { title: text },
      } satisfies SchedulingState,
    };
  }

  private stepCreateWhen(state: SchedulingState, text: string): ModelResult {
    const parsed = parseDateTime(text);
    if (!parsed) {
      return {
        replies: [
          {
            text: "Não entendi a data/hora. Use `DD/MM/AAAA HH:MM`, `hoje 15:00` ou `amanhã 09:30`.",
          },
        ],
        nextState: state,
      };
    }
    if (parsed.date.getTime() <= Date.now()) {
      return {
        replies: [{ text: "A data/hora precisa ser no *futuro*. Tente de novo:" }],
        nextState: state,
      };
    }
    return {
      replies: [
        {
          text: [
            `Agendado para *${formatDateTime(parsed.date)}*.`,
            "",
            "Com quanto de antecedência quer o lembrete?",
            "Exemplos: `30 minutos`, `1 hora`, `2 horas`, `1 dia`",
            "Ou envie *ok* / *padrão* (1 hora antes).",
          ].join("\n"),
        },
      ],
      nextState: {
        step: "create_reminder",
        draft: {
          ...state.draft,
          title: state.draft?.title,
          scheduledAt: parsed.date.toISOString(),
        },
      },
    };
  }

  private stepCreateReminder(state: SchedulingState, text: string): ModelResult {
    const minutes = parseReminderMinutes(text);
    if (minutes === null || minutes < 1) {
      return {
        replies: [
          {
            text: "Não entendi o lembrete. Exemplos: `30 minutos`, `1 hora`, `1 dia` ou `padrão`.",
          },
        ],
        nextState: state,
      };
    }
    const scheduledAt = state.draft?.scheduledAt
      ? new Date(state.draft.scheduledAt)
      : null;
    if (scheduledAt && scheduledAt.getTime() - minutes * 60_000 <= Date.now()) {
      return {
        replies: [
          {
            text: "Esse lembrete cairia no passado. Escolha menos antecedência ou outra data.",
          },
        ],
        nextState: state,
      };
    }
    return {
      replies: [
        {
          text: `Lembrete: *${formatReminderLabel(minutes)}*.\n\nDescrição? (opcional)\nEnvie o texto ou *pular*.`,
        },
      ],
      nextState: {
        step: "create_description",
        draft: { ...state.draft, remindBeforeMinutes: minutes },
      },
    };
  }

  private stepCreateDescription(state: SchedulingState, text: string): ModelResult {
    const description = SKIP.has(text.toLowerCase()) ? null : text;
    const draft: Draft = {
      ...state.draft,
      description,
      remindBeforeMinutes: state.draft?.remindBeforeMinutes ?? 60,
    };
    return {
      replies: [{ text: this.confirmCreateText(draft) }],
      nextState: { step: "create_confirm", draft },
    };
  }

  private async stepCreateConfirm(
    ctx: ModelContext,
    phone: string,
    state: SchedulingState,
    lower: string,
  ): Promise<ModelResult> {
    if (["nao", "não", "n", "cancelar"].includes(lower)) {
      return {
        replies: [{ text: "Criação cancelada." }],
        nextState: { step: "idle" },
      };
    }
    if (!["sim", "s", "ok", "confirmar", "yes"].includes(lower)) {
      return {
        replies: [{ text: "Responda *sim* para salvar ou *não* para cancelar." }],
        nextState: state,
      };
    }

    const draft = state.draft;
    if (!draft?.title || !draft.scheduledAt) {
      return {
        replies: [{ text: "Dados incompletos. Vamos recomeçar." }],
        nextState: { step: "idle" },
      };
    }

    try {
      const created = await this.getRepo().create({
        tenantId: ctx.tenantId,
        phone,
        title: draft.title,
        description: draft.description,
        scheduledAt: new Date(draft.scheduledAt),
        remindBeforeMinutes: draft.remindBeforeMinutes ?? 60,
      });

      return {
        replies: [
          {
            text: `✅ Compromisso salvo no *Google Calendar*!\n\n${formatAppointment(created)}`,
          },
        ],
        nextState: { step: "idle" },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "erro desconhecido";
      return {
        replies: [
          {
            text: `Não consegui salvar no Google Calendar.\n_${msg}_\n\nVerifique as credenciais e tente de novo.`,
          },
        ],
        nextState: { step: "idle" },
      };
    }
  }

  private confirmCreateText(draft: Draft): string {
    const when = draft.scheduledAt
      ? formatDateTime(new Date(draft.scheduledAt))
      : "-";
    return [
      "*Confirmar compromisso no Google Calendar?*",
      `• Título: ${draft.title}`,
      `• Quando: ${when}`,
      `• Lembrete: ${formatReminderLabel(draft.remindBeforeMinutes ?? 60)}`,
      `• Descrição: ${draft.description || "(sem)"}`,
      "",
      "Responda *sim* ou *não*.",
    ].join("\n");
  }

  private async listReport(ctx: ModelContext, phone: string): Promise<ModelResult> {
    try {
      const items = await this.getRepo().listActive(ctx.tenantId, phone);
      if (items.length === 0) {
        return {
          replies: [
            {
              text: "Você não tem compromissos futuros. Digite *1* para criar.",
            },
          ],
          nextState: { step: "idle" },
        };
      }
      const body = items.map((a, i) => formatAppointment(a, i + 1)).join("\n\n");
      return {
        replies: [
          {
            text: `*📋 Seus compromissos (${items.length})*\n\n${body}`,
          },
        ],
        nextState: { step: "idle" },
      };
    } catch (err) {
      return this.googleConfigError(err);
    }
  }

  private async listUpcomingWeek(
    ctx: ModelContext,
    phone: string,
  ): Promise<ModelResult> {
    try {
      const items = await this.getRepo().listActive(ctx.tenantId, phone);
      const limit = Date.now() + 7 * 24 * 60 * 60_000;
      const week = items.filter((a) => a.scheduledAt.getTime() <= limit);
      if (week.length === 0) {
        return {
          replies: [{ text: "Nenhum compromisso nos próximos 7 dias." }],
          nextState: { step: "idle" },
        };
      }
      const body = week.map((a, i) => formatAppointment(a, i + 1)).join("\n\n");
      return {
        replies: [{ text: `*🗓️ Próximos 7 dias*\n\n${body}` }],
        nextState: { step: "idle" },
      };
    } catch (err) {
      return this.googleConfigError(err);
    }
  }

  private async stepQuery(
    ctx: ModelContext,
    phone: string,
    text: string,
    mode: "edit" | "cancel",
  ): Promise<ModelResult> {
    try {
      const found = await this.getRepo().search(ctx.tenantId, phone, text);
      const all =
        found.length > 0 ? found : await this.getRepo().listActive(ctx.tenantId, phone);

      if (all.length === 0) {
        return {
          replies: [{ text: "Nenhum compromisso encontrado. Digite *1* para criar." }],
          nextState: { step: "idle" },
        };
      }

      if (found.length === 1) {
        const selected = found[0]!;
        if (mode === "edit") {
          return {
            replies: [
              {
                text: [
                  `Encontrei:\n${formatAppointment(selected)}`,
                  "",
                  "O que deseja editar?",
                  "*1* Título  *2* Data/hora  *3* Lembrete  *4* Descrição",
                  "*0* Voltar",
                ].join("\n"),
              },
            ],
            nextState: {
              step: "edit_field",
              selectedId: selected.id,
              candidates: [selected.id],
            },
          };
        }
        return {
          replies: [
            {
              text: `Cancelar este compromisso?\n\n${formatAppointment(selected)}\n\n*sim* / *não*`,
            },
          ],
          nextState: {
            step: "cancel_confirm",
            selectedId: selected.id,
            candidates: [selected.id],
          },
        };
      }

      const intro =
        found.length === 0
          ? "Não achei pelo filtro. Aqui estão *todos* para você escolher:"
          : `Encontrei *${found.length}* compromissos. Escolha o número:`;

      const body = all.map((a, i) => formatAppointment(a, i + 1)).join("\n\n");
      return {
        replies: [{ text: `${intro}\n\n${body}\n\n_Digite o número ou *0* para voltar._` }],
        nextState: {
          step: mode === "edit" ? "edit_pick" : "cancel_pick",
          candidates: all.map((a) => a.id),
        },
      };
    } catch (err) {
      return this.googleConfigError(err);
    }
  }

  private stepPick(
    state: SchedulingState,
    text: string,
    mode: "edit" | "cancel",
  ): ModelResult {
    if (text.trim() === "0") {
      return this.home();
    }
    const idx = Number(text.trim());
    const candidates = state.candidates ?? [];
    if (!Number.isInteger(idx) || idx < 1 || idx > candidates.length) {
      return {
        replies: [
          {
            text: `Digite um número de 1 a ${candidates.length}, ou *0* para voltar.`,
          },
        ],
        nextState: state,
      };
    }
    const selectedId = candidates[idx - 1]!;
    if (mode === "edit") {
      return {
        replies: [
          {
            text: [
              "O que deseja editar?",
              "*1* Título  *2* Data/hora  *3* Lembrete  *4* Descrição",
              "*0* Voltar",
            ].join("\n"),
          },
        ],
        nextState: { step: "edit_field", selectedId, candidates },
      };
    }
    return {
      replies: [{ text: "Confirma o cancelamento? *sim* / *não*" }],
      nextState: { step: "cancel_confirm", selectedId, candidates },
    };
  }

  private stepEditField(state: SchedulingState, lower: string): ModelResult {
    if (lower === "0") {
      return this.home();
    }
    const map: Record<string, SchedulingState["editField"]> = {
      "1": "title",
      titulo: "title",
      título: "title",
      "2": "when",
      data: "when",
      hora: "when",
      "3": "reminder",
      lembrete: "reminder",
      "4": "description",
      descricao: "description",
      descrição: "description",
    };
    const field = map[lower];
    if (!field) {
      return {
        replies: [{ text: "Opção inválida. Use 1–4 ou *0* para voltar." }],
        nextState: state,
      };
    }
    const prompts: Record<NonNullable<SchedulingState["editField"]>, string> = {
      title: "Novo *título*:",
      when: "Nova *data/hora* (ex.: `29/07/2026 10:00`):",
      reminder: "Novo lembrete (ex.: `30 minutos`, `2 horas`):",
      description: "Nova *descrição* (ou *pular* para limpar):",
    };
    return {
      replies: [{ text: prompts[field] }],
      nextState: { ...state, step: "edit_value", editField: field },
    };
  }

  private async stepEditValue(
    ctx: ModelContext,
    phone: string,
    state: SchedulingState,
    text: string,
  ): Promise<ModelResult> {
    const id = state.selectedId;
    if (!id || !state.editField) {
      return this.home();
    }

    try {
      if (state.editField === "title") {
        if (text.trim().length < 2) {
          return {
            replies: [{ text: "Título inválido. Tente de novo:" }],
            nextState: state,
          };
        }
        await this.getRepo().update(id, ctx.tenantId, phone, { title: text });
      } else if (state.editField === "when") {
        const parsed = parseDateTime(text);
        if (!parsed || parsed.date.getTime() <= Date.now()) {
          return {
            replies: [{ text: "Data/hora inválida ou no passado. Tente de novo:" }],
            nextState: state,
          };
        }
        await this.getRepo().update(id, ctx.tenantId, phone, {
          scheduledAt: parsed.date,
        });
      } else if (state.editField === "reminder") {
        const minutes = parseReminderMinutes(text);
        if (minutes === null || minutes < 1) {
          return {
            replies: [{ text: "Lembrete inválido. Tente de novo:" }],
            nextState: state,
          };
        }
        await this.getRepo().update(id, ctx.tenantId, phone, {
          remindBeforeMinutes: minutes,
        });
      } else {
        await this.getRepo().update(id, ctx.tenantId, phone, {
          description: SKIP.has(text.toLowerCase()) ? null : text,
        });
      }
    } catch {
      return {
        replies: [
          {
            text: "Não foi possível atualizar no Google Calendar. Tente novamente mais tarde.",
          },
        ],
        nextState: { step: "idle" },
      };
    }

    const updated = await this.getRepo().findById(id, ctx.tenantId, phone);
    return {
      replies: [
        {
          text: updated
            ? `✏️ Atualizado no Google Calendar!\n\n${formatAppointment(updated)}`
            : "Atualizado.",
        },
      ],
      nextState: { step: "idle" },
    };
  }

  private async stepCancelConfirm(
    ctx: ModelContext,
    phone: string,
    state: SchedulingState,
    lower: string,
  ): Promise<ModelResult> {
    if (["nao", "não", "n"].includes(lower)) {
      return {
        replies: [{ text: "Cancelamento abortado." }],
        nextState: { step: "idle" },
      };
    }
    if (!["sim", "s", "ok", "confirmar"].includes(lower)) {
      return {
        replies: [{ text: "Responda *sim* ou *não*." }],
        nextState: state,
      };
    }
    if (!state.selectedId) {
      return this.home();
    }
    try {
      const updated = await this.getRepo().update(
        state.selectedId,
        ctx.tenantId,
        phone,
        { status: "cancelled" },
      );
      return {
        replies: [
          {
            text: updated
              ? `🗑️ Compromisso *${updated.title}* cancelado e removido do Google Calendar.`
              : "Compromisso cancelado.",
          },
        ],
        nextState: { step: "idle" },
      };
    } catch {
      return {
        replies: [
          {
            text: "Não foi possível cancelar no Google Calendar. Tente novamente mais tarde.",
          },
        ],
        nextState: { step: "idle" },
      };
    }
  }

  private googleConfigError(err: unknown): ModelResult {
    const msg = err instanceof Error ? err.message : "erro desconhecido";
    return {
      replies: [
        {
          text: `Google Calendar indisponível.\n_${msg}_`,
        },
      ],
      nextState: { step: "idle" },
    };
  }
}
