import type {
  BotModel,
  IncomingMessage,
  ModelContext,
  ModelResult,
} from "../types.js";
import type { ClinicAppointment, ClinicClient, ClinicSlot } from "./clinic.types.js";

type Step =
  | "idle"
  | "book_service"
  | "book_professional"
  | "book_slot"
  | "book_name"
  | "book_confirm"
  | "cancel_pick"
  | "cancel_confirm"
  | "reschedule_pick"
  | "reschedule_slot"
  | "reschedule_confirm";

type ClinicState = {
  step: Step;
  serviceId?: string;
  serviceName?: string;
  professionalId?: string;
  options?: string[];
  slots?: ClinicSlot[];
  selectedSlotId?: string;
  patientName?: string;
  appointmentIds?: string[];
  selectedAppointmentId?: string;
  /** parallel to appointmentIds for reschedule */
  appointmentServiceIds?: string[];
  appointmentProfessionalIds?: string[];
};

const EXIT = new Set(["sair", "exit", "encerrar"]);
const HELP = new Set(["ajuda", "help", "?", "menu", "0", "voltar", "inicio", "início"]);

function formatSlot(slot: ClinicSlot, index: number): string {
  const when = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(slot.start));
  return `*${index}.* ${when} — ${slot.professionalName}`;
}

function formatAppt(a: ClinicAppointment, index?: number): string {
  const prefix = index !== undefined ? `*${index}.* ` : "";
  const when =
    a.startLabel ??
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(a.start));
  return `${prefix}*${a.service.name}*\n👤 ${a.professional.name}\n📅 ${when}`;
}

export class ClinicModel implements BotModel {
  readonly id = "clinic" as const;
  readonly capabilities = ["clinic-booking", "availability", "cancel", "reschedule"];

  constructor(private readonly client: ClinicClient) {}

  async onStart(ctx: ModelContext, message: IncomingMessage): Promise<ModelResult> {
    const text = message.text.trim().toLowerCase();
    if (text && !HELP.has(text)) {
      return this.handleMessage({ ...ctx, sessionState: { step: "idle" } }, message);
    }
    return this.home();
  }

  async handleMessage(ctx: ModelContext, message: IncomingMessage): Promise<ModelResult> {
    const text = message.text.trim();
    const lower = text.toLowerCase();
    const state = (ctx.sessionState as ClinicState) ?? { step: "idle" };

    if (EXIT.has(lower)) {
      return {
        replies: [{ text: "Atendimento da clínica encerrado. Envie *modelo clinica* para voltar." }],
        nextState: {},
        endSession: true,
      };
    }
    if (HELP.has(lower) && state.step !== "book_name") {
      return this.home();
    }

    try {
      switch (state.step) {
        case "book_service":
          return await this.pickService(state, text);
        case "book_professional":
          return await this.pickProfessional(state, text);
        case "book_slot":
          return this.pickSlot(state, text);
        case "book_name":
          return this.pickName(state, text);
        case "book_confirm":
          return await this.confirmBook(message.phone, state, lower);
        case "cancel_pick":
          return this.pickForCancel(state, text);
        case "cancel_confirm":
          return await this.confirmCancel(message.phone, state, lower);
        case "reschedule_pick":
          return await this.pickForReschedule(state, text);
        case "reschedule_slot":
          return this.pickRescheduleSlot(state, text);
        case "reschedule_confirm":
          return await this.confirmReschedule(message.phone, state, lower);
        case "idle":
        default:
          return await this.routeIdle(message.phone, text, lower);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro na clínica";
      return {
        replies: [{ text: `⚠️ ${msg}\n\nDigite *menu* para recomeçar.` }],
        nextState: { step: "idle" },
      };
    }
  }

  private home(): ModelResult {
    return {
      replies: [
        {
          text: [
            "*🧠 Clínica Mente em Equilíbrio*",
            "Agendamento pelo WhatsApp",
            "",
            "*1* - Ver horários e agendar",
            "*2* - Meus agendamentos",
            "*3* - Cancelar consulta",
            "*4* - Remarcar consulta",
            "",
            "_Digite *menu* para voltar aqui._",
            "_Outros bots: *modelo menu* | *modelo agenda*_ ",
          ].join("\n"),
        },
      ],
      nextState: { step: "idle" } satisfies ClinicState,
    };
  }

  private async routeIdle(phone: string, text: string, lower: string): Promise<ModelResult> {
    if (["1", "agendar", "marcar", "horario", "horário"].includes(lower)) {
      const services = await this.client.listServices();
      if (services.length === 0) {
        return {
          replies: [{ text: "Nenhum serviço disponível no momento." }],
          nextState: { step: "idle" },
        };
      }
      const list = services
        .map((s, i) => `*${i + 1}* - ${s.name} (${s.durationMinutes} min)`)
        .join("\n");
      return {
        replies: [{ text: `Qual serviço?\n\n${list}` }],
        nextState: { step: "book_service", options: services.map((s) => s.id) },
      };
    }

    if (["2", "meus", "lista", "consultas", "agendamentos"].includes(lower)) {
      return this.listMine(phone);
    }
    if (["3", "cancelar"].includes(lower)) {
      return this.startPickAppointments(phone, "cancel");
    }
    if (["4", "remarcar", "reagendar"].includes(lower)) {
      return this.startPickAppointments(phone, "reschedule");
    }

    return {
      replies: [{ text: `Não entendi "${text}".\n\n${this.home().replies[0]?.text}` }],
      nextState: { step: "idle" },
    };
  }

  private async pickService(state: ClinicState, text: string): Promise<ModelResult> {
    const ids = state.options ?? [];
    const idx = Number(text.trim());
    if (!Number.isInteger(idx) || idx < 1 || idx > ids.length) {
      return {
        replies: [{ text: `Escolha um número de 1 a ${ids.length}.` }],
        nextState: state,
      };
    }
    const serviceId = ids[idx - 1]!;
    const services = await this.client.listServices();
    const service = services.find((s) => s.id === serviceId);
    const professionals = await this.client.listProfessionals(serviceId);
    const list = [
      `*0* - Qualquer profissional`,
      ...professionals.map((p, i) => `*${i + 1}* - ${p.name}`),
    ].join("\n");
    return {
      replies: [{ text: `Serviço: *${service?.name}*\n\nEscolha o psicólogo:\n\n${list}` }],
      nextState: {
        step: "book_professional",
        serviceId,
        serviceName: service?.name,
        options: professionals.map((p) => p.id),
      },
    };
  }

  private async pickProfessional(state: ClinicState, text: string): Promise<ModelResult> {
    const ids = state.options ?? [];
    const raw = text.trim();
    let professionalId: string | undefined;

    if (raw !== "0") {
      const idx = Number(raw);
      if (!Number.isInteger(idx) || idx < 1 || idx > ids.length) {
        return {
          replies: [{ text: `Escolha 0 a ${ids.length}.` }],
          nextState: state,
        };
      }
      professionalId = ids[idx - 1];
    }

    const slots = await this.client.getAvailability({
      serviceId: state.serviceId!,
      professionalId,
      days: 14,
    });
    if (slots.length === 0) {
      return {
        replies: [
          {
            text: "Não há horários livres nos próximos 14 dias. Tente outro profissional ou *menu*.",
          },
        ],
        nextState: { step: "idle" },
      };
    }
    const shown = slots.slice(0, 12);
    return {
      replies: [
        {
          text: `Horários disponíveis:\n\n${shown.map((s, i) => formatSlot(s, i + 1)).join("\n")}\n\n_Digite o número do horário._`,
        },
      ],
      nextState: {
        step: "book_slot",
        serviceId: state.serviceId,
        serviceName: state.serviceName,
        professionalId,
        slots: shown,
      },
    };
  }

  private pickSlot(state: ClinicState, text: string): ModelResult {
    const slots = state.slots ?? [];
    const idx = Number(text.trim());
    if (!Number.isInteger(idx) || idx < 1 || idx > slots.length) {
      return {
        replies: [{ text: `Escolha um horário de 1 a ${slots.length}.` }],
        nextState: state,
      };
    }
    const slot = slots[idx - 1]!;
    return {
      replies: [
        {
          text: `Horário selecionado:\n${formatSlot(slot, idx)}\n\nQual seu *nome completo*?`,
        },
      ],
      nextState: {
        ...state,
        step: "book_name",
        selectedSlotId: slot.id,
        professionalId: slot.professionalId,
      },
    };
  }

  private pickName(state: ClinicState, text: string): ModelResult {
    if (text.trim().length < 3) {
      return { replies: [{ text: "Informe um nome válido:" }], nextState: state };
    }
    const slot = (state.slots ?? []).find((s) => s.id === state.selectedSlotId);
    if (!slot) return this.home();
    return {
      replies: [
        {
          text: [
            "*Confirmar agendamento?*",
            `• Serviço: ${state.serviceName}`,
            `• Profissional: ${slot.professionalName}`,
            `• Quando: ${formatSlot(slot, 1).replace(/^\*\d+\.\*\s*/, "")}`,
            `• Paciente: ${text.trim()}`,
            "",
            "Responda *sim* ou *não*.",
          ].join("\n"),
        },
      ],
      nextState: { ...state, step: "book_confirm", patientName: text.trim() },
    };
  }

  private async confirmBook(
    phone: string,
    state: ClinicState,
    lower: string,
  ): Promise<ModelResult> {
    if (["nao", "não", "n"].includes(lower)) {
      return { replies: [{ text: "Agendamento não realizado." }], nextState: { step: "idle" } };
    }
    if (!["sim", "s", "ok", "confirmar"].includes(lower)) {
      return { replies: [{ text: "Responda *sim* ou *não*." }], nextState: state };
    }
    const slot = (state.slots ?? []).find((s) => s.id === state.selectedSlotId);
    if (!slot || !state.serviceId) return this.home();

    const created = await this.client.book({
      phone,
      patientName: state.patientName,
      serviceId: state.serviceId,
      professionalId: slot.professionalId,
      start: slot.start,
    });
    return {
      replies: [{ text: `✅ Consulta agendada!\n\n${formatAppt(created)}` }],
      nextState: { step: "idle" },
    };
  }

  private async listMine(phone: string): Promise<ModelResult> {
    const items = await this.client.listAppointments(phone);
    if (items.length === 0) {
      return {
        replies: [{ text: "Você não tem consultas futuras. Digite *1* para agendar." }],
        nextState: { step: "idle" },
      };
    }
    return {
      replies: [
        {
          text: `*📋 Suas consultas*\n\n${items.map((a, i) => formatAppt(a, i + 1)).join("\n\n")}`,
        },
      ],
      nextState: { step: "idle" },
    };
  }

  private async startPickAppointments(
    phone: string,
    mode: "cancel" | "reschedule",
  ): Promise<ModelResult> {
    const items = await this.client.listAppointments(phone);
    if (items.length === 0) {
      return {
        replies: [{ text: "Nenhuma consulta para alterar." }],
        nextState: { step: "idle" },
      };
    }
    const action = mode === "cancel" ? "cancelar" : "remarcar";
    return {
      replies: [
        {
          text: `Qual consulta deseja ${action}?\n\n${items.map((a, i) => formatAppt(a, i + 1)).join("\n\n")}\n\n_Digite o número._`,
        },
      ],
      nextState: {
        step: mode === "cancel" ? "cancel_pick" : "reschedule_pick",
        appointmentIds: items.map((a) => a.id),
        appointmentServiceIds: items.map((a) => a.service.id),
        appointmentProfessionalIds: items.map((a) => a.professional.id),
      },
    };
  }

  private pickForCancel(state: ClinicState, text: string): ModelResult {
    const ids = state.appointmentIds ?? [];
    const idx = Number(text.trim());
    if (!Number.isInteger(idx) || idx < 1 || idx > ids.length) {
      return {
        replies: [{ text: `Escolha de 1 a ${ids.length}.` }],
        nextState: state,
      };
    }
    return {
      replies: [{ text: "Confirma o *cancelamento*? *sim* / *não*" }],
      nextState: { step: "cancel_confirm", selectedAppointmentId: ids[idx - 1] },
    };
  }

  private async pickForReschedule(state: ClinicState, text: string): Promise<ModelResult> {
    const ids = state.appointmentIds ?? [];
    const idx = Number(text.trim());
    if (!Number.isInteger(idx) || idx < 1 || idx > ids.length) {
      return {
        replies: [{ text: `Escolha de 1 a ${ids.length}.` }],
        nextState: state,
      };
    }
    const selectedAppointmentId = ids[idx - 1]!;
    const serviceId = state.appointmentServiceIds?.[idx - 1];
    const professionalId = state.appointmentProfessionalIds?.[idx - 1];
    if (!serviceId) {
      return { replies: [{ text: "Não foi possível remarcar. Tente *4* de novo." }], nextState: { step: "idle" } };
    }

    const slots = await this.client.getAvailability({
      serviceId,
      professionalId,
      days: 14,
    });
    if (slots.length === 0) {
      return {
        replies: [{ text: "Sem horários livres para remarcar agora." }],
        nextState: { step: "idle" },
      };
    }
    const shown = slots.slice(0, 12);
    return {
      replies: [
        {
          text: `Escolha o novo horário:\n\n${shown.map((s, i) => formatSlot(s, i + 1)).join("\n")}`,
        },
      ],
      nextState: {
        step: "reschedule_slot",
        selectedAppointmentId,
        serviceId,
        slots: shown,
      },
    };
  }

  private async confirmCancel(
    phone: string,
    state: ClinicState,
    lower: string,
  ): Promise<ModelResult> {
    if (["nao", "não", "n"].includes(lower)) {
      return { replies: [{ text: "Cancelamento abortado." }], nextState: { step: "idle" } };
    }
    if (!["sim", "s", "ok"].includes(lower)) {
      return { replies: [{ text: "Responda *sim* ou *não*." }], nextState: state };
    }
    if (!state.selectedAppointmentId) return this.home();
    const cancelled = await this.client.cancel(state.selectedAppointmentId, phone);
    return {
      replies: [{ text: `🗑️ Consulta cancelada.\n\n${formatAppt(cancelled)}` }],
      nextState: { step: "idle" },
    };
  }

  private pickRescheduleSlot(state: ClinicState, text: string): ModelResult {
    const slots = state.slots ?? [];
    const idx = Number(text.trim());
    if (!Number.isInteger(idx) || idx < 1 || idx > slots.length) {
      return {
        replies: [{ text: `Escolha de 1 a ${slots.length}.` }],
        nextState: state,
      };
    }
    const slot = slots[idx - 1]!;
    return {
      replies: [
        {
          text: `Remarcar para:\n${formatSlot(slot, idx)}\n\nConfirma? *sim* / *não*`,
        },
      ],
      nextState: {
        ...state,
        step: "reschedule_confirm",
        selectedSlotId: slot.id,
        professionalId: slot.professionalId,
      },
    };
  }

  private async confirmReschedule(
    phone: string,
    state: ClinicState,
    lower: string,
  ): Promise<ModelResult> {
    if (["nao", "não", "n"].includes(lower)) {
      return { replies: [{ text: "Remarcação abortada." }], nextState: { step: "idle" } };
    }
    if (!["sim", "s", "ok"].includes(lower)) {
      return { replies: [{ text: "Responda *sim* ou *não*." }], nextState: state };
    }
    const slot = (state.slots ?? []).find((s) => s.id === state.selectedSlotId);
    if (!slot || !state.selectedAppointmentId) return this.home();
    const updated = await this.client.reschedule({
      id: state.selectedAppointmentId,
      phone,
      start: slot.start,
      professionalId: slot.professionalId,
    });
    return {
      replies: [{ text: `✏️ Consulta remarcada!\n\n${formatAppt(updated)}` }],
      nextState: { step: "idle" },
    };
  }
}
