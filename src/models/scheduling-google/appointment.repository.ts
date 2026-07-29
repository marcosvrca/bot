import type { PrismaClient } from "@prisma/client";
import { GoogleCalendarClient } from "./google-calendar.client.js";
import {
  computeEndsAt,
  computeRemindAt,
  type GoogleAppointmentRecord,
  type GoogleAppointmentStatus,
} from "./appointment.types.js";

function mapRow(row: {
  id: string;
  tenantId: string;
  phone: string;
  title: string;
  description: string | null;
  scheduledAt: Date;
  endsAt: Date;
  remindBeforeMinutes: number;
  remindAt: Date;
  reminderSentAt: Date | null;
  status: string;
  googleEventId: string;
  googleCalendarId: string;
}): GoogleAppointmentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    phone: row.phone,
    title: row.title,
    description: row.description,
    scheduledAt: row.scheduledAt,
    endsAt: row.endsAt,
    remindBeforeMinutes: row.remindBeforeMinutes,
    remindAt: row.remindAt,
    reminderSentAt: row.reminderSentAt,
    status: row.status as GoogleAppointmentStatus,
    googleEventId: row.googleEventId,
    googleCalendarId: row.googleCalendarId,
  };
}

export class GoogleAppointmentRepository {
  private calendar: GoogleCalendarClient | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  private getCalendar(): GoogleCalendarClient {
    if (!this.calendar) {
      this.calendar = new GoogleCalendarClient();
    }
    return this.calendar;
  }

  async create(input: {
    tenantId: string;
    phone: string;
    title: string;
    description?: string | null;
    scheduledAt: Date;
    remindBeforeMinutes: number;
  }): Promise<GoogleAppointmentRecord> {
    const title = input.title.trim();
    const description = input.description?.trim() || null;
    const endsAt = computeEndsAt(input.scheduledAt);
    const remindAt = computeRemindAt(input.scheduledAt, input.remindBeforeMinutes);
    const calendar = this.getCalendar();

    const googleEventId = await calendar.createEvent({
      title,
      description: appendPhoneNote(description, input.phone),
      scheduledAt: input.scheduledAt,
      endsAt,
      remindBeforeMinutes: input.remindBeforeMinutes,
    });

    try {
      const row = await this.prisma.googleAppointment.create({
        data: {
          tenantId: input.tenantId,
          phone: input.phone,
          title,
          description,
          scheduledAt: input.scheduledAt,
          endsAt,
          remindBeforeMinutes: input.remindBeforeMinutes,
          remindAt,
          status: "scheduled",
          googleEventId,
          googleCalendarId: calendar.configuredCalendarId,
        },
      });
      return mapRow(row);
    } catch (err) {
      await calendar.cancelEvent(googleEventId).catch(() => undefined);
      throw err;
    }
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
      status?: GoogleAppointmentStatus;
      reminderSentAt?: Date | null;
    },
  ): Promise<GoogleAppointmentRecord | null> {
    const current = await this.findById(id, tenantId, phone);
    if (!current) {
      return null;
    }

    const title = patch.title?.trim() ?? current.title;
    const description =
      patch.description === undefined
        ? current.description
        : patch.description?.trim() || null;
    const scheduledAt = patch.scheduledAt ?? current.scheduledAt;
    const remindBeforeMinutes = patch.remindBeforeMinutes ?? current.remindBeforeMinutes;
    const endsAt = computeEndsAt(scheduledAt);
    const scheduleChanged =
      patch.scheduledAt !== undefined || patch.remindBeforeMinutes !== undefined;
    const contentChanged =
      patch.title !== undefined ||
      patch.description !== undefined ||
      scheduleChanged;

    const calendar = this.getCalendar();
    if (patch.status === "cancelled") {
      await calendar.cancelEvent(current.googleEventId);
    } else if (contentChanged && current.status === "scheduled") {
      await calendar.updateEvent(current.googleEventId, {
        title,
        description: appendPhoneNote(description, phone),
        scheduledAt,
        endsAt,
        remindBeforeMinutes,
      });
    }

    const row = await this.prisma.googleAppointment.update({
      where: { id },
      data: {
        title: patch.title?.trim() ?? undefined,
        description:
          patch.description === undefined ? undefined : patch.description?.trim() || null,
        scheduledAt: patch.scheduledAt,
        endsAt: scheduleChanged || patch.scheduledAt !== undefined ? endsAt : undefined,
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
  ): Promise<GoogleAppointmentRecord | null> {
    const row = await this.prisma.googleAppointment.findFirst({
      where: { id, tenantId, phone },
    });
    return row ? mapRow(row) : null;
  }

  async listActive(tenantId: string, phone: string): Promise<GoogleAppointmentRecord[]> {
    const now = new Date();
    const rows = await this.prisma.googleAppointment.findMany({
      where: {
        tenantId,
        phone,
        status: "scheduled",
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
  ): Promise<GoogleAppointmentRecord[]> {
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
      return (
        formatted.includes(q) ||
        iso.includes(q) ||
        q.split(/\s+/).every((part) => formatted.includes(part))
      );
    });
  }

  async dueReminders(limit = 50): Promise<GoogleAppointmentRecord[]> {
    const now = new Date();
    const rows = await this.prisma.googleAppointment.findMany({
      where: {
        status: "scheduled",
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
    await this.prisma.googleAppointment.update({
      where: { id },
      data: { reminderSentAt: new Date() },
    });
  }
}

function appendPhoneNote(description: string | null, phone: string): string {
  const note = `WhatsApp: ${phone}`;
  return description ? `${description}\n\n${note}` : note;
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

export function formatAppointment(a: GoogleAppointmentRecord, index?: number): string {
  const prefix = index !== undefined ? `*${index}.* ` : "";
  const lines = [
    `${prefix}*${a.title}*`,
    `📅 ${formatDateTime(a.scheduledAt)}`,
    `🔔 ${formatReminderLabel(a.remindBeforeMinutes)}`,
    `☁️ Google Calendar`,
  ];
  if (a.description) {
    lines.push(`📝 ${a.description}`);
  }
  return lines.join("\n");
}
