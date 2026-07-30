export type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "done";

export type AppointmentRecord = {
  id: string;
  tenantId: string;
  phone: string;
  title: string;
  description: string | null;
  scheduledAt: Date;
  remindBeforeMinutes: number;
  remindAt: Date;
  reminderSentAt: Date | null;
  status: AppointmentStatus;
};

export function computeRemindAt(scheduledAt: Date, remindBeforeMinutes: number): Date {
  return new Date(scheduledAt.getTime() - remindBeforeMinutes * 60_000);
}
