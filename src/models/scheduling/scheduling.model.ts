import type { PrismaClient } from "@prisma/client";
import type {
  BotModel,
  IncomingMessage,
  ModelContext,
  ModelResult,
} from "../types.js";
import {
  AppointmentRepository,
  formatAppointment,
  formatDateTime,
  formatReminderLabel,
} from "./appointment.repository.js";
import type { AppointmentRecord } from "./appointment.types.js";
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
  | "cancel_confirm"
  | "confirm_query"
  | "confirm_pick"
  | "confirm_confirm"
  | "reschedule_query"
  | "reschedule_pick"
  | "reschedule_when";

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

export class SchedulingModel implements BotModel {
  readonly id = "scheduling" as const;
  readonly capabilities = [
    "appointments",
    "reminders",
    "report",
    "edit",
    "cancel",
    "confirm",
    "reschedule",
  ];

  private readonly repo: AppointmentRepository;

  constructor(prisma: PrismaClient) {
    this.repo = new AppointmentRepository(prisma);
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
            text: "Agenda encerrada. Envie *modelo agenda* ou qualquer mensagem para voltar.",
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
      case "confirm_query":
        return this.stepQuery(ctx, message.phone, text, "confirm");
      case "confirm_pick":
        return this.stepPick(state, text, "confirm");
      case "confirm_confirm":
        return this.stepConfirmPresence(ctx, message.phone, state, lower);
      case "reschedule_query":
        return this.stepQuery(ctx, message.phone, text, "reschedule");
      case "reschedule_pick":
        return this.stepPick(state, text, "reschedule");
      case "reschedule_when":
        return this.stepRescheduleWhen(ctx, message.phone, state, text);
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
            "*📅 Agenda*",
            "",
            "Escolha uma opção:",
            "*1* - Novo compromisso",
            "*2* - Meus compromissos (relatório)",
            "*3* - Editar compromisso",
            "*4* - Cancelar compromisso",
            "*5* - Próximos 7 dias",
            "*6* - Confirmar presença",
            "*7* - Reagendar",
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
    if (["6", "confirmar", "confirmacao", "confirmação", "presenca", "presença"].includes(lower)) {
      return {
        replies: [
          {
            text: "Envie o *título* ou a *data/hora* do compromisso que deseja confirmar.",
          },
        ],
        nextState: { step: "confirm_query" },
      };
    }
    if (["7", "reagendar", "remarcar", "adiar"].includes(lower)) {
      return {
        replies: [
          {
            text: "Envie o *título* ou a *data/hora* do compromisso que deseja reagendar.",
          },
        ],
        nextState: { step: "reschedule_query" },
      };
    }

    // Atalho: se parecer data+texto, tenta fluxo rápido? Keep simple - show home
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

    const created = await this.repo.create({
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
          text: `✅ Compromisso salvo!\n\n${formatAppointment(created)}`,
        },
      ],
      nextState: { step: "idle" },
    };
  }

  private confirmCreateText(draft: Draft): string {
    const when = draft.scheduledAt
      ? formatDateTime(new Date(draft.scheduledAt))
      : "-";
    return [
      "*Confirmar compromisso?*",
      `• Título: ${draft.title}`,
      `• Quando: ${when}`,
      `• Lembrete: ${formatReminderLabel(draft.remindBeforeMinutes ?? 60)}`,
      `• Descrição: ${draft.description || "(sem)"}`,
      "",
      "Responda *sim* ou *não*.",
    ].join("\n");
  }

  private async listReport(ctx: ModelContext, phone: string): Promise<ModelResult> {
    const items = await this.repo.listActive(ctx.tenantId, phone);
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
  }

  private async listUpcomingWeek(
    ctx: ModelContext,
    phone: string,
  ): Promise<ModelResult> {
    const items = await this.repo.listActive(ctx.tenantId, phone);
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
  }

  private async stepQuery(
    ctx: ModelContext,
    phone: string,
    text: string,
    mode: "edit" | "cancel" | "confirm" | "reschedule",
  ): Promise<ModelResult> {
    const found = await this.repo.search(ctx.tenantId, phone, text);
    const all = found.length > 0 ? found : await this.repo.listActive(ctx.tenantId, phone);

    if (all.length === 0) {
      return {
        replies: [{ text: "Nenhum compromisso encontrado. Digite *1* para criar." }],
        nextState: { step: "idle" },
      };
    }

    if (found.length === 1) {
      const selected = found[0]!;
      return this.afterSelectAppointment(selected.id, [selected.id], mode, selected);
    }

    const intro =
      found.length === 0
        ? "Não achei pelo filtro. Aqui estão *todos* para você escolher:"
        : `Encontrei *${found.length}* compromissos. Escolha o número:`;

    const body = all.map((a, i) => formatAppointment(a, i + 1)).join("\n\n");
    const pickStep =
      mode === "edit"
        ? "edit_pick"
        : mode === "cancel"
          ? "cancel_pick"
          : mode === "confirm"
            ? "confirm_pick"
            : "reschedule_pick";

    return {
      replies: [{ text: `${intro}\n\n${body}\n\n_Digite o número ou *0* para voltar._` }],
      nextState: {
        step: pickStep,
        candidates: all.map((a) => a.id),
      },
    };
  }

  private stepPick(
    state: SchedulingState,
    text: string,
    mode: "edit" | "cancel" | "confirm" | "reschedule",
  ): ModelResult {
    if (text.trim() === "0") {
      return this.home();
    }
    const idx = Number(text.trim());
    const candidates = state.candidates ?? [];
    if (!Number.isInteger(idx) || idx < 1 || idx > candidates.length) {
      return {
        replies: [{ text: `Digite um número de 1 a ${candidates.length}, ou *0* para voltar.` }],
        nextState: state,
      };
    }
    const selectedId = candidates[idx - 1]!;
    return this.afterSelectAppointment(selectedId, candidates, mode);
  }

  private afterSelectAppointment(
    selectedId: string,
    candidates: string[],
    mode: "edit" | "cancel" | "confirm" | "reschedule",
    selected?: AppointmentRecord,
  ): ModelResult {
    if (mode === "edit") {
      return {
        replies: [
          {
            text: [
              selected ? `Encontrei:\n${formatAppointment(selected)}` : "Compromisso selecionado.",
              "",
              "O que deseja editar?",
              "*1* Título  *2* Data/hora  *3* Lembrete  *4* Descrição",
              "*0* Voltar",
            ].join("\n"),
          },
        ],
        nextState: {
          step: "edit_field",
          selectedId,
          candidates,
        },
      };
    }
    if (mode === "cancel") {
      return {
        replies: [
          {
            text: selected
              ? `Cancelar este compromisso?\n\n${formatAppointment(selected)}\n\n*sim* / *não*`
              : "Confirma o cancelamento? *sim* / *não*",
          },
        ],
        nextState: {
          step: "cancel_confirm",
          selectedId,
          candidates,
        },
      };
    }
    if (mode === "confirm") {
      return {
        replies: [
          {
            text: selected
              ? `Confirmar presença neste compromisso?\n\n${formatAppointment(selected)}\n\n*sim* / *não*`
              : "Confirma a presença? *sim* / *não*",
          },
        ],
        nextState: {
          step: "confirm_confirm",
          selectedId,
          candidates,
        },
      };
    }
    return {
      replies: [
        {
          text: selected
            ? `Reagendar:\n${formatAppointment(selected)}\n\nNova *data/hora*?\nEx.: \`29/07/2026 10:00\`, \`amanhã 09:30\``
            : "Nova *data/hora*? Ex.: `29/07/2026 10:00`",
        },
      ],
      nextState: {
        step: "reschedule_when",
        selectedId,
        candidates,
      },
    };
  }

  private async stepConfirmPresence(
    ctx: ModelContext,
    phone: string,
    state: SchedulingState,
    lower: string,
  ): Promise<ModelResult> {
    if (["nao", "não", "n"].includes(lower)) {
      return {
        replies: [{ text: "Confirmação cancelada." }],
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
    const updated = await this.repo.update(state.selectedId, ctx.tenantId, phone, {
      status: "confirmed",
    });
    return {
      replies: [
        {
          text: updated
            ? `✅ Presença confirmada!\n\n${formatAppointment(updated)}`
            : "Presença confirmada.",
        },
      ],
      nextState: { step: "idle" },
    };
  }

  private async stepRescheduleWhen(
    ctx: ModelContext,
    phone: string,
    state: SchedulingState,
    text: string,
  ): Promise<ModelResult> {
    const id = state.selectedId;
    if (!id) {
      return this.home();
    }
    const parsed = parseDateTime(text);
    if (!parsed || parsed.date.getTime() <= Date.now()) {
      return {
        replies: [
          {
            text: "Data/hora inválida ou no passado. Use `DD/MM/AAAA HH:MM`, `hoje 15:00` ou `amanhã 09:30`.",
          },
        ],
        nextState: state,
      };
    }
    const updated = await this.repo.update(id, ctx.tenantId, phone, {
      scheduledAt: parsed.date,
      status: "scheduled",
    });
    return {
      replies: [
        {
          text: updated
            ? `🔄 Reagendado!\n\n${formatAppointment(updated)}`
            : "Compromisso reagendado.",
        },
      ],
      nextState: { step: "idle" },
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
        await this.repo.update(id, ctx.tenantId, phone, { title: text });
      } else if (state.editField === "when") {
        const parsed = parseDateTime(text);
        if (!parsed || parsed.date.getTime() <= Date.now()) {
          return {
            replies: [{ text: "Data/hora inválida ou no passado. Tente de novo:" }],
            nextState: state,
          };
        }
        await this.repo.update(id, ctx.tenantId, phone, { scheduledAt: parsed.date });
      } else if (state.editField === "reminder") {
        const minutes = parseReminderMinutes(text);
        if (minutes === null || minutes < 1) {
          return {
            replies: [{ text: "Lembrete inválido. Tente de novo:" }],
            nextState: state,
          };
        }
        await this.repo.update(id, ctx.tenantId, phone, {
          remindBeforeMinutes: minutes,
        });
      } else {
        await this.repo.update(id, ctx.tenantId, phone, {
          description: SKIP.has(text.toLowerCase()) ? null : text,
        });
      }
    } catch {
      return {
        replies: [{ text: "Não foi possível atualizar. Tente novamente mais tarde." }],
        nextState: { step: "idle" },
      };
    }

    const updated = await this.repo.findById(id, ctx.tenantId, phone);
    return {
      replies: [
        {
          text: updated
            ? `✏️ Atualizado!\n\n${formatAppointment(updated)}`
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
    const updated = await this.repo.update(state.selectedId, ctx.tenantId, phone, {
      status: "cancelled",
    });
    return {
      replies: [
        {
          text: updated
            ? `🗑️ Compromisso *${updated.title}* cancelado.`
            : "Compromisso cancelado.",
        },
      ],
      nextState: { step: "idle" },
    };
  }
}
