import { describe, expect, it, vi } from "vitest";
import { DashboardService } from "./dashboard-service.js";

describe("DashboardService", () => {
  it("aggregates overview metrics", async () => {
    const prisma = {
      lead: {
        count: vi
          .fn()
          .mockResolvedValueOnce(10)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(5),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "1",
            name: "Ana",
            phone: "5511",
            interest: "Bot",
            origin: "menu",
            status: "new",
            createdAt: new Date(),
          },
        ]),
        groupBy: vi.fn().mockResolvedValue([{ origin: "menu", _count: { _all: 3 } }]),
      },
      messageLog: {
        count: vi.fn().mockResolvedValueOnce(40).mockResolvedValueOnce(22).mockResolvedValueOnce(18),
        findMany: vi.fn().mockResolvedValue([{ phone: "5511" }, { phone: "5512" }]),
      },
      appointment: {
        count: vi.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(1),
      },
      catalogItem: {
        count: vi.fn().mockResolvedValue(5),
      },
      conversationSession: {
        count: vi.fn().mockResolvedValue(3),
      },
    };

    const service = new DashboardService(prisma as never);
    const overview = await service.overview("tenant-1");

    expect(overview.metrics.leadsTotal).toBe(10);
    expect(overview.metrics.leadsToday).toBe(2);
    expect(overview.metrics.contactsWeek).toBe(2);
    expect(overview.metrics.catalogActive).toBe(5);
    expect(overview.leadsByOrigin).toEqual([{ origin: "menu", count: 3 }]);
    expect(overview.recentLeads).toHaveLength(1);
  });
});
