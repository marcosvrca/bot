import { describe, expect, it, vi } from "vitest";
import { CatalogModel } from "./catalog.model.js";
import { formatPriceBRL } from "./catalog.repository.js";

describe("formatPriceBRL", () => {
  it("formats cents to BRL", () => {
    expect(formatPriceBRL(48900)).toMatch(/489/);
    expect(formatPriceBRL(75000)).toMatch(/750/);
  });
});

describe("CatalogModel", () => {
  const items = [
    {
      id: "p1",
      tenantId: "t1",
      sku: "BAT-60",
      name: "Bateria Moura 60Ah",
      description: "Retirada hoje",
      priceCents: 48900,
      category: "Peças",
      active: true,
      sortOrder: 1,
      meta: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "p2",
      tenantId: "t1",
      sku: "CONS-01",
      name: "Consultoria inicial",
      description: "2h",
      priceCents: 75000,
      category: "Serviços",
      active: true,
      sortOrder: 2,
      meta: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  function createModel() {
    const prisma = {
      catalogItem: {
        findMany: vi.fn().mockImplementation(async (args: { where?: { OR?: unknown } }) => {
          if (args?.where && "OR" in (args.where as object)) {
            return [items[0]];
          }
          if (args?.where && "category" in (args.where as object)) {
            return [items[0]];
          }
          if (args?.where && "distinct" === undefined) {
            // list categories path uses distinct via different call - handled below
          }
          return items;
        }),
        findFirst: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          return items.find((i) => i.id === where.id) ?? null;
        }),
      },
    };

    // Override findMany for categories (distinct)
    prisma.catalogItem.findMany = vi.fn().mockImplementation(async (args: {
      distinct?: string[];
      where?: { category?: unknown; OR?: unknown };
      select?: { category: true };
    }) => {
      if (args.distinct) {
        return [{ category: "Peças" }, { category: "Serviços" }];
      }
      if (args.where?.OR) {
        return [items[0]];
      }
      if (args.where?.category) {
        return [items[0]];
      }
      return items;
    });

    return new CatalogModel(prisma as never);
  }

  const ctx = {
    tenantId: "t1",
    instance: "demo",
    modelId: "catalog" as const,
    sessionState: {},
  };

  it("shows home on start", async () => {
    const model = createModel();
    const result = await model.onStart(ctx, {
      phone: "5511999999999",
      text: "oi",
      messageType: "conversation",
    });
    expect(result.replies[0]?.text).toContain("Catálogo");
    expect(result.nextState).toEqual({ step: "idle" });
  });

  it("lists products and opens detail", async () => {
    const model = createModel();
    const list = await model.handleMessage(
      { ...ctx, sessionState: { step: "idle" } },
      { phone: "5511999999999", text: "1", messageType: "conversation" },
    );
    expect(list.replies[0]?.text).toContain("Bateria Moura");
    expect(list.nextState).toMatchObject({ step: "pick" });

    const detail = await model.handleMessage(
      { ...ctx, sessionState: list.nextState },
      { phone: "5511999999999", text: "1", messageType: "conversation" },
    );
    expect(detail.replies[0]?.text).toContain("R$");
    expect(detail.nextState).toMatchObject({ step: "detail", selectedId: "p1" });
  });

  it("hands off to leads with product interest", async () => {
    const model = createModel();
    const result = await model.handleMessage(
      {
        ...ctx,
        sessionState: { step: "detail", selectedId: "p1", candidates: ["p1"] },
      },
      { phone: "5511999999999", text: "quero", messageType: "conversation" },
    );
    expect(result.nextModel).toBe("leads");
    expect(result.nextState).toMatchObject({
      origin: "catalog",
      interest: "Bateria Moura 60Ah",
    });
  });
});
