import { PrismaClient, type Prisma } from "@prisma/client";
import { defaultMenuFlow } from "../src/models/menu/menu.flows.js";

const prisma = new PrismaClient();
const menuFlowJson = defaultMenuFlow as unknown as Prisma.InputJsonValue;

const DEMO_CATALOG: Array<{
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  category: string;
  sortOrder: number;
}> = [
  {
    sku: "CONS-01",
    name: "Consultoria inicial",
    description: "Diagnóstico de processos e plano de ação (2h).",
    priceCents: 75000,
    category: "Serviços",
    sortOrder: 1,
  },
  {
    sku: "SUP-01",
    name: "Suporte técnico mensal",
    description: "Pacote mensal de suporte remoto com SLA.",
    priceCents: 49700,
    category: "Serviços",
    sortOrder: 2,
  },
  {
    sku: "BOT-START",
    name: "Bot WhatsApp Start",
    description: "Menu + captura de leads + hospedagem básica.",
    priceCents: 49700,
    category: "Produtos",
    sortOrder: 3,
  },
  {
    sku: "BOT-BIZ",
    name: "Bot WhatsApp Business",
    description: "Start + agenda, catálogo e integrações.",
    priceCents: 149700,
    category: "Produtos",
    sortOrder: 4,
  },
  {
    sku: "BAT-60",
    name: "Bateria Moura 60Ah",
    description: "Exemplo de item de estoque. Retirada sob consulta.",
    priceCents: 48900,
    category: "Peças",
    sortOrder: 5,
  },
  {
    sku: "LAND-01",
    name: "Landing page",
    description: "Página institucional com formulário e WhatsApp.",
    priceCents: 75000,
    category: "Produtos",
    sortOrder: 6,
  },
];

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 60 * 60_000);
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60_000);
}

function daysFromNow(d: number, hour = 10): Date {
  const x = new Date();
  x.setDate(x.getDate() + d);
  x.setHours(hour, 0, 0, 0);
  return x;
}

async function main() {
  const slug = process.env.DEMO_TENANT_SLUG ?? "demo";
  const instance = process.env.DEMO_EVOLUTION_INSTANCE ?? "demo";
  const defaultModel = process.env.DEMO_DEFAULT_MODEL ?? "menu";
  const activeModels = [
    "menu",
    "leads",
    "catalog",
    "scheduling",
    "scheduling-google",
    "clinic",
  ];

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: {
      name: "Demo Tenant",
      slug,
      active: true,
      config: {
        create: {
          evolutionInstance: instance,
          activeModels,
          defaultModel,
          menuFlow: menuFlowJson,
        },
      },
    },
    update: {
      active: true,
      name: "Demo Tenant",
      config: {
        upsert: {
          create: {
            evolutionInstance: instance,
            activeModels,
            defaultModel,
            menuFlow: menuFlowJson,
          },
          update: {
            evolutionInstance: instance,
            activeModels,
            defaultModel,
            menuFlow: menuFlowJson,
            // preserva leadsWebhookUrl já configurado no painel
          },
        },
      },
    },
    include: { config: true },
  });

  for (const item of DEMO_CATALOG) {
    const existing = await prisma.catalogItem.findFirst({
      where: { tenantId: tenant.id, sku: item.sku },
    });
    if (existing) {
      await prisma.catalogItem.update({
        where: { id: existing.id },
        data: { ...item, active: true },
      });
    } else {
      await prisma.catalogItem.create({
        data: { tenantId: tenant.id, ...item, active: true },
      });
    }
  }

  // Limpa dados operacionais demo e recreia (idempotente para testes)
  await prisma.messageLog.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.lead.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.appointment.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.conversationSession.deleteMany({ where: { tenantId: tenant.id } });

  const leads = await Promise.all([
    prisma.lead.create({
      data: {
        tenantId: tenant.id,
        phone: "5511999900001",
        name: "Ana Silva",
        email: "ana.silva@email.com",
        interest: "Bot WhatsApp Business",
        city: "São Paulo",
        origin: "menu",
        status: "new",
        notes: "Pediu orçamento pelo menu.",
        createdAt: hoursAgo(2),
      },
    }),
    prisma.lead.create({
      data: {
        tenantId: tenant.id,
        phone: "5511999900002",
        name: "Bruno Costa",
        email: "bruno@empresa.com",
        interest: "Consultoria inicial",
        city: "Campinas",
        origin: "catalog",
        status: "contacted",
        notes: "Já respondeu no WhatsApp.",
        createdAt: hoursAgo(26),
      },
    }),
    prisma.lead.create({
      data: {
        tenantId: tenant.id,
        phone: "5511999900003",
        name: "Carla Mendes",
        email: null,
        interest: "Landing page",
        city: "Santos",
        origin: "whatsapp",
        status: "qualified",
        createdAt: hoursAgo(50),
      },
    }),
    prisma.lead.create({
      data: {
        tenantId: tenant.id,
        phone: "5511999900004",
        name: "Diego Alves",
        email: "diego@loja.com",
        interest: "Bateria Moura 60Ah",
        city: "Guarulhos",
        origin: "catalog",
        status: "won",
        notes: "Compra confirmada.",
        createdAt: hoursAgo(70),
      },
    }),
    prisma.lead.create({
      data: {
        tenantId: tenant.id,
        phone: "5511999900005",
        name: "Elena Rocha",
        email: "elena@clinic.com",
        interest: "Agenda + lembretes",
        city: "São Paulo",
        origin: "menu",
        status: "lost",
        notes: "Optou por concorrente.",
        createdAt: hoursAgo(90),
      },
    }),
  ]);

  const appointments = [
    {
      phone: "5511999900001",
      title: "Demo mvFlow Bots",
      description: "Apresentação do painel e catálogo",
      scheduledAt: daysFromNow(1, 14),
      status: "scheduled",
      remindBeforeMinutes: 60,
    },
    {
      phone: "5511999900002",
      title: "Consultoria inicial",
      description: "Kickoff com Bruno",
      scheduledAt: daysFromNow(2, 10),
      status: "confirmed",
      remindBeforeMinutes: 120,
    },
    {
      phone: "5511999900003",
      title: "Alinhamento landing page",
      description: null,
      scheduledAt: daysFromNow(3, 16),
      status: "scheduled",
      remindBeforeMinutes: 60,
    },
    {
      phone: "5511999900004",
      title: "Retirada bateria",
      description: "Loja centro",
      scheduledAt: hoursFromNow(5),
      status: "confirmed",
      remindBeforeMinutes: 30,
    },
  ];

  for (const ap of appointments) {
    const remindAt = new Date(
      ap.scheduledAt.getTime() - ap.remindBeforeMinutes * 60_000,
    );
    await prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        phone: ap.phone,
        title: ap.title,
        description: ap.description,
        scheduledAt: ap.scheduledAt,
        remindBeforeMinutes: ap.remindBeforeMinutes,
        remindAt,
        status: ap.status,
      },
    });
  }

  type ChatScript = {
    phone: string;
    pushName: string;
    model: string;
    humanTakeover?: boolean;
    lines: Array<{ dir: "inbound" | "outbound"; text: string; hoursAgo: number }>;
  };

  const chats: ChatScript[] = [
    {
      phone: "5511999900001",
      pushName: "Ana Silva",
      model: "menu",
      lines: [
        { dir: "inbound", text: "oi", hoursAgo: 3 },
        {
          dir: "outbound",
          text: "Olá! Sou o assistente virtual.\nEscolha uma opção:\n\n*1* - Horários\n*2* - Serviços\n*3* - Catálogo\n*4* - Contato",
          hoursAgo: 2.95,
        },
        { dir: "inbound", text: "3", hoursAgo: 2.9 },
        {
          dir: "outbound",
          text: "*🛒 Catálogo*\n\n*1* - Ver produtos\n*2* - Buscar",
          hoursAgo: 2.85,
        },
        { dir: "inbound", text: "1", hoursAgo: 2.8 },
        {
          dir: "outbound",
          text: "*Bot WhatsApp Business* — R$ 1.497,00\nDigite *quero* para registrar interesse.",
          hoursAgo: 2.75,
        },
        { dir: "inbound", text: "quero", hoursAgo: 2.7 },
        {
          dir: "outbound",
          text: "Cadastro salvo com sucesso!\nNome: Ana Silva\nInteresse: Bot WhatsApp Business",
          hoursAgo: 2.65,
        },
      ],
    },
    {
      phone: "5511999900002",
      pushName: "Bruno Costa",
      model: "leads",
      humanTakeover: true,
      lines: [
        { dir: "inbound", text: "preciso de consultoria", hoursAgo: 5 },
        {
          dir: "outbound",
          text: "Vou registrar seu contato.\nQual o seu *nome completo*?",
          hoursAgo: 4.95,
        },
        { dir: "inbound", text: "Bruno Costa", hoursAgo: 4.9 },
        {
          dir: "outbound",
          text: "Olá Bruno! Aqui é a equipe comercial. Podemos falar amanhã às 10h?",
          hoursAgo: 4.5,
        },
        { dir: "inbound", text: "Pode sim, perfeito.", hoursAgo: 4.4 },
        {
          dir: "outbound",
          text: "Agendado! Até amanhã 👍",
          hoursAgo: 4.35,
        },
      ],
    },
    {
      phone: "5511999900003",
      pushName: "Carla Mendes",
      model: "scheduling",
      lines: [
        { dir: "inbound", text: "modelo agenda", hoursAgo: 8 },
        {
          dir: "outbound",
          text: "*📅 Agenda*\n*1* - Novo compromisso\n*2* - Meus compromissos",
          hoursAgo: 7.95,
        },
        { dir: "inbound", text: "1", hoursAgo: 7.9 },
        { dir: "outbound", text: "Qual o *título* do compromisso?", hoursAgo: 7.85 },
        { dir: "inbound", text: "Alinhamento landing page", hoursAgo: 7.8 },
        {
          dir: "outbound",
          text: "✅ Compromisso salvo!\n📅 em 3 dias às 16:00",
          hoursAgo: 7.7,
        },
      ],
    },
    {
      phone: "5511999900004",
      pushName: "Diego Alves",
      model: "catalog",
      lines: [
        { dir: "inbound", text: "tem bateria moura?", hoursAgo: 12 },
        {
          dir: "outbound",
          text: "*Bateria Moura 60Ah*\n💰 R$ 489,00\nRetirada sob consulta.",
          hoursAgo: 11.9,
        },
        { dir: "inbound", text: "quero", hoursAgo: 11.8 },
        {
          dir: "outbound",
          text: "Lead salvo. Nossa equipe confirma a retirada.",
          hoursAgo: 11.7,
        },
      ],
    },
    {
      phone: "5511999900005",
      pushName: "Elena Rocha",
      model: "menu",
      lines: [
        { dir: "inbound", text: "horário de vocês?", hoursAgo: 20 },
        {
          dir: "outbound",
          text: "*Horários*\nAtendemos de segunda a sexta, das 09:00 às 18:00.",
          hoursAgo: 19.95,
        },
        { dir: "inbound", text: "ok obrigada", hoursAgo: 19.9 },
      ],
    },
  ];

  for (const chat of chats) {
    await prisma.conversationSession.create({
      data: {
        tenantId: tenant.id,
        phone: chat.phone,
        model: chat.model,
        state: chat.humanTakeover
          ? { humanTakeover: true, takenOverAt: new Date().toISOString() }
          : {},
        updatedAt: hoursAgo(chat.lines[chat.lines.length - 1]!.hoursAgo),
      },
    });

    for (const line of chat.lines) {
      await prisma.messageLog.create({
        data: {
          tenantId: tenant.id,
          phone: chat.phone,
          direction: line.dir,
          body: line.text,
          meta:
            line.dir === "inbound"
              ? { pushName: chat.pushName, messageType: "conversation" }
              : { source: chat.humanTakeover ? "dashboard" : "bot" },
          createdAt: hoursAgo(line.hoursAgo),
        },
      });
    }
  }

  const catalogCount = await prisma.catalogItem.count({
    where: { tenantId: tenant.id, active: true },
  });

  console.log(
    [
      `Seed demo OK — tenant "${tenant.slug}" / instance "${instance}"`,
      `  menu: default hub`,
      `  catalog: ${catalogCount} itens`,
      `  leads: ${leads.length}`,
      `  appointments: ${appointments.length}`,
      `  conversations: ${chats.length}`,
      `  messages: ${chats.reduce((n, c) => n + c.lines.length, 0)}`,
      tenant.config?.leadsWebhookUrl
        ? `  webhook CRM: ${tenant.config.leadsWebhookUrl}`
        : `  webhook CRM: (não configurado)`,
    ].join("\n"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
