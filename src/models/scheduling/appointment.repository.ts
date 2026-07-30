import type { PrismaClient } from "@prisma/client";
import {
  computeRemindAt,
  type AppointmentRecord,
  type AppointmentStatus,
} from "./appointment.types.js";

function mapRow(row: {
  id: string;
  tenantId: string;
  phone: string;
  title: string;
  description: string | null;
  scheduledAt: Date;
  remindBeforeMinutes: number;
  remindAt: Date;
  reminderSentAt: Date | null;
  status: string;
}): AppointmentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    phone: row.phone,
    title: row.title,
    description: row.description,
    scheduledAt: row.scheduledAt,
    remindBeforeMinutes: row.remindBeforeMinutes,
    remindAt: row.remindAt,
    reminderSentAt: row.reminderSentAt,
    status: row.status as AppointmentStatus,
  };
}

export class AppointmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: {
    tenantId: string;
    phone: string;
    title: string;
    description?: string | null;
    scheduledAt: Date;
    remindBeforeMinutes: number;
  }): Promise<AppointmentRecord> {
    const remindAt = computeRemindAt(input.scheduledAt, input.remindBeforeMinutes);
    const row = await this.prisma.appointment.create({
      data: {
        tenantId: input.tenantId,
        phone: input.phone,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        scheduledAt: input.scheduledAt,
        remindBeforeMinutes: input.remindBeforeMinutes,
        remindAt,
        status: "scheduled",
      },
    });
    return mapRow(row);
  }

  async update(
    id: string,
    tenantId: string,
    phone: string,
    patch: {
      title?: string;
      description?: string | null;
      scheduledAt?: Date;
      remindBeforeMinutes?: number;
      status?: AppointmentStatus;
      reminderSentAt?: Date | null;
    },
  ): Promise<AppointmentRecord | null> {
    const current = await this.findById(id, tenantId, phone);
    if (!current) {
      return null;
    }

    const scheduledAt = patch.scheduledAt ?? current.scheduledAt;
    const remindBeforeMinutes = patch.remindBeforeMinutes ?? current.remindBeforeMinutes;
    const scheduleChanged =
      patch.scheduledAt !== undefined || patch.remindBeforeMinutes !== undefined;

    const row = await this.prisma.appointment.update({
      where: { id },
      data: {
        title: patch.title?.trim() ?? undefined,
        description:
          patch.description === undefined ? undefined : patch.description?.trim() || null,
        scheduledAt: patch.scheduledAt,
        remindBeforeMinutes: patch.remindBeforeMinutes,
        remindAt: scheduleChanged
          ? computeRemindAt(scheduledAt, remindBeforeMinutes)
          : undefined,
        reminderSentAt: scheduleChanged ? null : patch.reminderSentAt,
        status: patch.status,
      },
    });
    return mapRow(row);
  }

  async findById(
    id: string,
    tenantId: string,
    phone: string,
  ): Promise<AppointmentRecord | null> {
    const row = await this.prisma.appointment.findFirst({
      where: { id, tenantId, phone },
    });
    return row ? mapRow(row) : null;
  }

  async listActive(tenantId: string, phone: string): Promise<AppointmentRecord[]> {
    const now = new Date();
    const rows = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        phone,
        status: { in: ["scheduled", "confirmed"] },
        scheduledAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
      },
      orderBy: { scheduledAt: "asc" },
      take: 50,
    });
    return rows.map(mapRow);
  }

  async search(
    tenantId: string,
    phone: string,
    query: string,
  ): Promise<AppointmentRecord[]> {
    const list = await this.listActive(tenantId, phone);
    const q = query.trim().toLowerCase();
    if (!q) {
      return list;
    }

    const byTitle = list.filter((a) => a.title.toLowerCase().includes(q));
    if (byTitle.length > 0) {
      return byTitle;
    }

    return list.filter((a) => {
      const formatted = formatDateTime(a.scheduledAt).toLowerCase();
      const iso = a.scheduledAt.toISOString().toLowerCase();
      return formatted.includes(q) || iso.includes(q) || q.split(/\s+/).every((part) => formatted.includes(part));
    });
  }

  async dueReminders(limit = 50): Promise<AppointmentRecord[]> {
    const now = new Date();
    const rows = await this.prisma.appointment.findMany({
      where: {
        status: { in: ["scheduled", "confirmed"] },
        reminderSentAt: null,
        remindAt: { lte: now },
        scheduledAt: { gte: now },
      },
      orderBy: { remindAt: "asc" },
      take: limit,
    });
    return rows.map(mapRow);
  }

  async markReminderSent(id: string): Promise<void> {
    await this.prisma.appointment.update({
      where: { id },
      data: { reminderSentAt: new Date() },
    });
  }
}

export function formatDateTime(date: Date, timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatReminderLabel(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? "1 dia antes" : `${days} dias antes`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hora antes" : `${hours} horas antes`;
  }
  return minutes === 1 ? "1 minuto antes" : `${minutes} minutos antes`;
}

export function formatAppointment(a: AppointmentRecord, index?: number): string {
  const prefix = index !== undefined ? `*${index}.* ` : "";
  const statusLabel =
    a.status === "confirmed" ? " ✅ confirmado" : a.status === "scheduled" ? "" : ` (${a.status})`;
  const lines = [
    `${prefix}*${a.title}*${statusLabel}`,
    `📅 ${formatDateTime(a.scheduledAt)}`,
    `🔔 ${formatReminderLabel(a.remindBeforeMinutes)}`,
  ];
  if (a.description) {
    lines.push(`📝 ${a.description}`);
  }
  return lines.join("\n");
}
