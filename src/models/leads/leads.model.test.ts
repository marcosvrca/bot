import { describe, expect, it, vi } from "vitest";
import { LeadsModel } from "./leads.model.js";

function createModel() {
  const lead = {
    id: "lead_abc123456",
    tenantId: "t1",
    phone: "5511999999999",
    name: "Ana Silva",
    email: "ana@example.com",
    interest: "Consultoria",
    city: "São Paulo",
    origin: "menu",
    status: "new",
    notes: null,
    meta: null,
    createdAt: new Date("2026-01-15T12:00:00.000Z"),
    updatedAt: new Date("2026-01-15T12:00:00.000Z"),
  };

  const prisma = {
    lead: {
      create: vi.fn().mockResolvedValue(lead),
    },
    tenantConfig: {
      findUnique: vi.fn().mockResolvedValue({
        leadsWebhookUrl: null,
        tenant: { slug: "demo" },
      }),
    },
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };

  const model = new LeadsModel(prisma as never, logger as never);
  return { model, prisma, lead };
}

describe("LeadsModel", () => {
  const ctx = {
    tenantId: "t1",
    instance: "demo",
    modelId: "leads" as const,
    sessionState: {},
  };

  it("starts asking for name and keeps seed interest", async () => {
    const { model } = createModel();
    const result = await model.onStart(
      { ...ctx, sessionState: { origin: "menu", interest: "Orçamento" } },
      { phone: "5511999999999", text: "oi", messageType: "conversation" },
    );
    expect(result.replies[0]?.text).toContain("nome completo");
    expect(result.replies[0]?.text).toContain("Orçamento");
    expect(result.nextState).toMatchObject({
      step: "name",
      interest: "Orçamento",
      origin: "menu",
    });
  });

  it("walks capture flow and saves lead", async () => {
    const { model, prisma, lead } = createModel();
    const phone = "5511999999999";

    let state = (
      await model.onStart(ctx, { phone, text: "oi", messageType: "conversation" })
    ).nextState;

    const nameStep = await model.handleMessage(
      { ...ctx, sessionState: state },
      { phone, text: "Ana Silva", messageType: "conversation" },
    );
    expect(nameStep.nextState).toMatchObject({ step: "email", name: "Ana Silva" });
    state = nameStep.nextState;

    const emailStep = await model.handleMessage(
      { ...ctx, sessionState: state },
      { phone, text: "ana@example.com", messageType: "conversation" },
    );
    expect(emailStep.nextState).toMatchObject({ step: "interest" });
    state = emailStep.nextState;

    const interestStep = await model.handleMessage(
      { ...ctx, sessionState: state },
      { phone, text: "Consultoria", messageType: "conversation" },
    );
    expect(interestStep.nextState).toMatchObject({ step: "city", interest: "Consultoria" });
    state = interestStep.nextState;

    const cityStep = await model.handleMessage(
      { ...ctx, sessionState: state },
      { phone, text: "São Paulo", messageType: "conversation" },
    );
    expect(cityStep.nextState).toMatchObject({ step: "confirm", city: "São Paulo" });
    expect(cityStep.replies[0]?.text).toContain("Confira os dados");
    state = cityStep.nextState;

    const saved = await model.handleMessage(
      { ...ctx, sessionState: state },
      { phone, text: "sim", messageType: "conversation" },
    );

    expect(prisma.lead.create).toHaveBeenCalled();
    expect(saved.nextModel).toBe("menu");
    expect(saved.replies[0]?.text).toContain("Cadastro salvo");
    expect(saved.replies[0]?.text).toContain(lead.name);
  });

  it("returns to menu on menu command", async () => {
    const { model } = createModel();
    const result = await model.handleMessage(
      { ...ctx, sessionState: { step: "name", origin: "whatsapp" } },
      { phone: "5511999999999", text: "menu", messageType: "conversation" },
    );
    expect(result.nextModel).toBe("menu");
    expect(result.nextState).toEqual({});
  });
});
