import { google, type calendar_v3 } from "googleapis";
import { env } from "../../config/env.js";

export type GoogleCalendarEventInput = {
  title: string;
  description?: string | null;
  scheduledAt: Date;
  endsAt: Date;
  remindBeforeMinutes: number;
};

export class GoogleCalendarClient {
  private readonly calendar: calendar_v3.Calendar;
  private readonly calendarId: string;
  private readonly timeZone: string;

  constructor() {
    const cfg = env();
    if (
      !cfg.GOOGLE_CALENDAR_CLIENT_ID ||
      !cfg.GOOGLE_CALENDAR_CLIENT_SECRET ||
      !cfg.GOOGLE_CALENDAR_REFRESH_TOKEN
    ) {
      throw new Error(
        "Google Calendar não configurado. Defina GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET e GOOGLE_CALENDAR_REFRESH_TOKEN.",
      );
    }

    const auth = new google.auth.OAuth2(
      cfg.GOOGLE_CALENDAR_CLIENT_ID,
      cfg.GOOGLE_CALENDAR_CLIENT_SECRET,
    );
    auth.setCredentials({ refresh_token: cfg.GOOGLE_CALENDAR_REFRESH_TOKEN });

    this.calendar = google.calendar({ version: "v3", auth });
    this.calendarId = cfg.GOOGLE_CALENDAR_ID;
    this.timeZone = cfg.GOOGLE_CALENDAR_TIMEZONE;
  }

  get configuredCalendarId(): string {
    return this.calendarId;
  }

  async createEvent(input: GoogleCalendarEventInput): Promise<string> {
    const res = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: this.toEventBody(input),
    });
    const id = res.data.id;
    if (!id) {
      throw new Error("Google Calendar não retornou o ID do evento.");
    }
    return id;
  }

  async updateEvent(eventId: string, input: GoogleCalendarEventInput): Promise<void> {
    await this.calendar.events.patch({
      calendarId: this.calendarId,
      eventId,
      requestBody: this.toEventBody(input),
    });
  }

  async cancelEvent(eventId: string): Promise<void> {
    try {
      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId,
      });
    } catch (err) {
      const status = (err as { code?: number }).code;
      if (status === 404 || status === 410) {
        return;
      }
      throw err;
    }
  }

  private toEventBody(input: GoogleCalendarEventInput): calendar_v3.Schema$Event {
    return {
      summary: input.title,
      description: input.description?.trim() || undefined,
      start: {
        dateTime: toLocalDateTime(input.scheduledAt, this.timeZone),
        timeZone: this.timeZone,
      },
      end: {
        dateTime: toLocalDateTime(input.endsAt, this.timeZone),
        timeZone: this.timeZone,
      },
      reminders: {
        useDefault: false,
        overrides: [
          {
            method: "popup",
            minutes: Math.min(Math.max(input.remindBeforeMinutes, 0), 40320),
          },
        ],
      },
    };
  }
}

function toLocalDateTime(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
}
