import type { MenuFlow } from "../../models/menu/menu.flows.js";

/** Menu pronto para fisioterapeuta (atendimento domiciliar). */
export const fisioMenuFlow: MenuFlow = {
  start: "root",
  nodes: {
    root: {
      id: "root",
      type: "menu",
      title: "Olá! Sou o assistente da Fisioterapia Domiciliar.",
      body: "Como posso ajudar?",
      options: [
        { key: "1", label: "Agendar avaliação / sessão", next: "goto_scheduling" },
        { key: "2", label: "Ver serviços e preços", next: "goto_catalog" },
        { key: "3", label: "Horários de atendimento", next: "hours" },
        { key: "4", label: "Quero ser contactado", next: "lead_capture" },
        { key: "5", label: "Falar com a fisioterapeuta", next: "handoff" },
      ],
    },
    hours: {
      id: "hours",
      type: "message",
      title: "Horários",
      body: "Atendimento domiciliar de segunda a sábado, das 08:00 às 20:00 (mediante agenda).",
      next: "root",
    },
    goto_scheduling: {
      id: "goto_scheduling",
      type: "model",
      title: "Agendamento",
      body: "Vamos agendar sua sessão domiciliar.",
      model: "scheduling",
    },
    goto_catalog: {
      id: "goto_catalog",
      type: "model",
      title: "Serviços",
      body: "Abrindo o catálogo de serviços e preços…",
      model: "catalog",
    },
    lead_capture: {
      id: "lead_capture",
      type: "model",
      title: "Contato",
      body: "Perfeito! Vamos registrar seus dados para retorno.",
      model: "leads",
      seed: { origin: "menu", interest: "Fisioterapia domiciliar" },
    },
    handoff: {
      id: "handoff",
      type: "handoff",
      title: "Atendimento humano",
      body: "Certo! Em breve a fisioterapeuta continua esta conversa. Digite *menu* para voltar ao bot.",
    },
  },
};

export const fisioCatalog = [
  {
    sku: "FISIO-AVAL",
    name: "Avaliação fisioterapêutica",
    description: "Avaliação completa no domicílio (60 min).",
    priceCents: 18000,
    category: "Domiciliar",
    sortOrder: 1,
  },
  {
    sku: "FISIO-SESS",
    name: "Sessão de fisioterapia",
    description: "Sessão terapêutica domiciliar (50 min).",
    priceCents: 15000,
    category: "Domiciliar",
    sortOrder: 2,
  },
  {
    sku: "FISIO-PAC10",
    name: "Pacote 10 sessões",
    description: "Pacote com desconto para continuidade do tratamento.",
    priceCents: 135000,
    category: "Pacotes",
    sortOrder: 3,
  },
  {
    sku: "FISIO-RPG",
    name: "RPG / postura",
    description: "Sessão focada em reeducação postural (50 min).",
    priceCents: 17000,
    category: "Domiciliar",
    sortOrder: 4,
  },
] as const;
