export type MenuOption = {
  key: string;
  label: string;
  next: string;
};

export type MenuNode =
  | {
      id: string;
      type: "menu";
      title: string;
      body?: string;
      options: MenuOption[];
    }
  | {
      id: string;
      type: "message";
      title: string;
      body: string;
      next?: string;
    }
  | {
      id: string;
      type: "handoff";
      title: string;
      body: string;
    }
  | {
      id: string;
      type: "model";
      title: string;
      body?: string;
      /** BotModelId alvo (ex.: leads, scheduling). */
      model: string;
      /** Estado inicial repassado ao modelo (ex.: interesse pré-preenchido). */
      seed?: Record<string, unknown>;
    };

export type MenuFlow = {
  start: string;
  nodes: Record<string, MenuNode>;
};

export const defaultMenuFlow: MenuFlow = {
  start: "root",
  nodes: {
    root: {
      id: "root",
      type: "menu",
      title: "Olá! Sou o assistente virtual.",
      body: "Escolha uma opção:",
      options: [
        { key: "1", label: "Horários de atendimento", next: "hours" },
        { key: "2", label: "Nossos serviços", next: "services" },
        { key: "3", label: "Ver catálogo / preços", next: "goto_catalog" },
        { key: "4", label: "Quero ser contactado", next: "lead_capture" },
        { key: "5", label: "Agendar horário", next: "goto_scheduling" },
        { key: "6", label: "Falar com um atendente", next: "handoff" },
      ],
    },
    hours: {
      id: "hours",
      type: "message",
      title: "Horários",
      body: "Atendemos de segunda a sexta, das 09:00 às 18:00.",
      next: "root",
    },
    services: {
      id: "services",
      type: "menu",
      title: "Serviços",
      body: "Qual serviço deseja conhecer?",
      options: [
        { key: "1", label: "Consultoria", next: "service_consulting" },
        { key: "2", label: "Suporte técnico", next: "service_support" },
        { key: "3", label: "Quero orçamento", next: "lead_quote" },
        { key: "4", label: "Ver catálogo", next: "goto_catalog" },
        { key: "0", label: "Voltar ao menu", next: "root" },
      ],
    },
    service_consulting: {
      id: "service_consulting",
      type: "message",
      title: "Consultoria",
      body: "Oferecemos consultoria especializada para otimizar seus processos.",
      next: "services",
    },
    service_support: {
      id: "service_support",
      type: "message",
      title: "Suporte técnico",
      body: "Nosso suporte resolve incidentes e tira dúvidas técnicas.",
      next: "services",
    },
    goto_catalog: {
      id: "goto_catalog",
      type: "model",
      title: "Catálogo",
      body: "Abrindo o catálogo de produtos e preços…",
      model: "catalog",
    },
    lead_capture: {
      id: "lead_capture",
      type: "model",
      title: "Contato",
      body: "Perfeito! Vamos registrar seus dados para a equipe entrar em contato.",
      model: "leads",
      seed: { origin: "menu" },
    },
    lead_quote: {
      id: "lead_quote",
      type: "model",
      title: "Orçamento",
      body: "Certo! Vamos coletar seus dados para montar um orçamento.",
      model: "leads",
      seed: { origin: "menu", interest: "Orçamento" },
    },
    goto_scheduling: {
      id: "goto_scheduling",
      type: "model",
      title: "Agenda",
      body: "Abrindo a agenda…",
      model: "scheduling",
    },
    handoff: {
      id: "handoff",
      type: "handoff",
      title: "Atendimento humano",
      body: "Certo! Em breve um atendente vai continuar esta conversa. Digite *menu* para voltar ao bot.",
    },
  },
};

export function parseMenuFlow(raw: unknown): MenuFlow {
  if (!raw || typeof raw !== "object") {
    return defaultMenuFlow;
  }
  const candidate = raw as MenuFlow;
  if (!candidate.start || !candidate.nodes || typeof candidate.nodes !== "object") {
    return defaultMenuFlow;
  }
  if (!candidate.nodes[candidate.start]) {
    return defaultMenuFlow;
  }
  return candidate;
}
