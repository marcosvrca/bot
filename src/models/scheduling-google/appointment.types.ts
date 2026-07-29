export type GoogleAppointmentStatus = "scheduled" | "cancelled" | "done";

export type GoogleAppointmentRecord = {
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
  status: GoogleAppointmentStatus;
  googleEventId: string;
  googleCalendarId: string;
};

export const DEFAULT_DURATION_MINUTES = 60;

export function computeRemindAt(scheduledAt: Date, remindBeforeMinutes: number): Date {
  return new Date(scheduledAt.getTime() - remindBeforeMinutes * 60_000);
}

export function computeEndsAt(
  scheduledAt: Date,
  durationMinutes = DEFAULT_DURATION_MINUTES,
): Date {
  return new Date(scheduledAt.getTime() + durationMinutes * 60_000);
}
