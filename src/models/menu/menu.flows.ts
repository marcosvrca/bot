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
        { key: "3", label: "Falar com um atendente", next: "handoff" },
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
