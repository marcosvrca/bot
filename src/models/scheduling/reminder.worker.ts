import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../../config/logger.js";
import type { OutboundService } from "../../core/messaging/outbound-service.js";
import {
  AppointmentRepository,
  formatAppointment,
  formatDateTime,
} from "./appointment.repository.js";

export function startReminderWorker(params: {
  prisma: PrismaClient;
  outbound: OutboundService;
  logger: Logger;
  intervalMs?: number;
}): { stop: () => void } {
  const repo = new AppointmentRepository(params.prisma);
  const intervalMs = params.intervalMs ?? 30_000;
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      const due = await repo.dueReminders(30);
      for (const appointment of due) {
        const config = await params.prisma.tenantConfig.findUnique({
          where: { tenantId: appointment.tenantId },
        });
        if (!config) {
          continue;
        }

        const minutesLeft = Math.max(
          0,
          Math.round((appointment.scheduledAt.getTime() - Date.now()) / 60_000),
        );

        await params.outbound.sendMany({
          tenantId: appointment.tenantId,
          instance: config.evolutionInstance,
          phone: appointment.phone,
          messages: [
            {
              text: [
                "⏰ *Lembrete de compromisso*",
                "",
                formatAppointment(appointment),
                "",
                `Faltam cerca de *${minutesLeft} min* (às ${formatDateTime(appointment.scheduledAt)}).`,
              ].join("\n"),
            },
          ],
        });

        await repo.markReminderSent(appointment.id);
        params.logger.info(
          { appointmentId: appointment.id, phone: appointment.phone },
          "reminder.sent",
        );
      }
    } catch (err) {
      params.logger.error({ err }, "reminder.worker.error");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
