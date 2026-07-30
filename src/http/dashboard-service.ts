import type { PrismaClient } from "@prisma/client";

function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60_000);
}

export class DashboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveTenant(slug: string) {
    return this.prisma.tenant.findUnique({
      where: { slug },
      include: { config: true },
    });
  }

  async overview(tenantId: string) {
    const today = startOfDay();
    const week = daysAgo(7);
    const now = new Date();

    const [
      leadsTotal,
      leadsToday,
      leadsWeek,
      messagesWeek,
      messagesInWeek,
      messagesOutWeek,
      appointmentsUpcoming,
      appointmentsConfirmed,
      catalogActive,
      sessionsActive,
      recentLeads,
      leadsByOrigin,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { tenantId } }),
      this.prisma.lead.count({ where: { tenantId, createdAt: { gte: today } } }),
      this.prisma.lead.count({ where: { tenantId, createdAt: { gte: week } } }),
      this.prisma.messageLog.count({ where: { tenantId, createdAt: { gte: week } } }),
      this.prisma.messageLog.count({
        where: { tenantId, direction: "inbound", createdAt: { gte: week } },
      }),
      this.prisma.messageLog.count({
        where: { tenantId, direction: "outbound", createdAt: { gte: week } },
      }),
      this.prisma.appointment.count({
        where: {
          tenantId,
          status: { in: ["scheduled", "confirmed"] },
          scheduledAt: { gte: now },
        },
      }),
      this.prisma.appointment.count({
        where: {
          tenantId,
          status: "confirmed",
          scheduledAt: { gte: now },
        },
      }),
      this.prisma.catalogItem.count({ where: { tenantId, active: true } }),
      this.prisma.conversationSession.count({
        where: { tenantId, updatedAt: { gte: daysAgo(1) } },
      }),
      this.prisma.lead.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          name: true,
          phone: true,
          interest: true,
          origin: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.lead.groupBy({
        by: ["origin"],
        where: { tenantId, createdAt: { gte: week } },
        _count: { _all: true },
      }),
    ]);

    const uniquePhonesWeek = await this.prisma.messageLog.findMany({
      where: { tenantId, createdAt: { gte: week }, direction: "inbound" },
      distinct: ["phone"],
      select: { phone: true },
    });

    return {
      generatedAt: new Date().toISOString(),
      metrics: {
        leadsTotal,
        leadsToday,
        leadsWeek,
        messagesWeek,
        messagesInWeek,
        messagesOutWeek,
        contactsWeek: uniquePhonesWeek.length,
        appointmentsUpcoming,
        appointmentsConfirmed,
        catalogActive,
        sessionsActive,
      },
      leadsByOrigin: leadsByOrigin.map((row) => ({
        origin: row.origin,
        count: row._count._all,
      })),
      recentLeads,
    };
  }

  async messages(tenantId: string, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 200);
    return this.prisma.messageLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        phone: true,
        direction: true,
        body: true,
        createdAt: true,
        meta: true,
      },
    });
  }

  async conversations(tenantId: string, limit = 40) {
    const take = Math.min(Math.max(limit, 1), 100);
    const recent = await this.prisma.messageLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 800,
      select: {
        phone: true,
        direction: true,
        body: true,
        createdAt: true,
        meta: true,
      },
    });

    const byPhone = new Map<
      string,
      {
        phone: string;
        lastMessage: string | null;
        lastDirection: string;
        lastAt: Date;
        pushName: string | null;
      }
    >();

    for (const row of recent) {
      if (byPhone.has(row.phone)) continue;
      const meta = row.meta as { pushName?: string } | null;
      byPhone.set(row.phone, {
        phone: row.phone,
        lastMessage: row.body,
        lastDirection: row.direction,
        lastAt: row.createdAt,
        pushName: meta?.pushName ?? null,
      });
      if (byPhone.size >= take) break;
    }

    const phones = [...byPhone.keys()];
    const [sessions, leads] = await Promise.all([
      this.prisma.conversationSession.findMany({
        where: { tenantId, phone: { in: phones } },
        select: { phone: true, model: true, state: true, updatedAt: true },
      }),
      this.prisma.lead.findMany({
        where: { tenantId, phone: { in: phones } },
        orderBy: { createdAt: "desc" },
        select: { phone: true, name: true, interest: true },
      }),
    ]);

    const sessionByPhone = new Map(sessions.map((s) => [s.phone, s]));
    const leadByPhone = new Map<string, { name: string; interest: string | null }>();
    for (const lead of leads) {
      if (!leadByPhone.has(lead.phone)) {
        leadByPhone.set(lead.phone, { name: lead.name, interest: lead.interest });
      }
    }

    return [...byPhone.values()].map((conv) => {
      const session = sessionByPhone.get(conv.phone);
      const state = (session?.state as Record<string, unknown> | null) ?? {};
      const lead = leadByPhone.get(conv.phone);
      return {
        ...conv,
        lastAt: conv.lastAt.toISOString(),
        displayName: lead?.name || conv.pushName || conv.phone,
        interest: lead?.interest ?? null,
        model: session?.model ?? null,
        humanTakeover: state.humanTakeover === true,
      };
    });
  }

  async thread(tenantId: string, phone: string, limit = 120) {
    const take = Math.min(Math.max(limit, 1), 300);
    const items = await this.prisma.messageLog.findMany({
      where: { tenantId, phone },
      orderBy: { createdAt: "asc" },
      take,
      select: {
        id: true,
        phone: true,
        direction: true,
        body: true,
        createdAt: true,
        meta: true,
      },
    });

    const [session, lead] = await Promise.all([
      this.prisma.conversationSession.findUnique({
        where: { tenantId_phone: { tenantId, phone } },
        select: { model: true, state: true, updatedAt: true },
      }),
      this.prisma.lead.findFirst({
        where: { tenantId, phone },
        orderBy: { createdAt: "desc" },
        select: { name: true, email: true, interest: true, city: true, status: true },
      }),
    ]);

    const state = (session?.state as Record<string, unknown> | null) ?? {};
    const pushName = items
      .map((m) => (m.meta as { pushName?: string } | null)?.pushName)
      .find((n) => Boolean(n));

    return {
      phone,
      displayName: lead?.name || pushName || phone,
      lead,
      model: session?.model ?? null,
      humanTakeover: state.humanTakeover === true,
      messages: items.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async appointments(tenantId: string, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 200);
    const now = new Date();
    return this.prisma.appointment.findMany({
      where: {
        tenantId,
        status: { in: ["scheduled", "confirmed"] },
        scheduledAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
      },
      orderBy: { scheduledAt: "asc" },
      take,
      select: {
        id: true,
        phone: true,
        title: true,
        description: true,
        scheduledAt: true,
        status: true,
        remindBeforeMinutes: true,
        reminderSentAt: true,
      },
    });
  }
}
