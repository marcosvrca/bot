import { describe, expect, it } from "vitest";
import { MenuModel } from "./menu.model.js";
import { defaultMenuFlow } from "./menu.flows.js";
import { renderNode, resolveOption, getNode } from "./menu.handlers.js";

describe("menu handlers", () => {
  it("renders numbered options", () => {
    const root = getNode(defaultMenuFlow, "root");
    const text = renderNode(root);
    expect(text).toContain("*1* - Horários de atendimento");
    expect(text).toContain("*3* - Ver catálogo / preços");
    expect(text).toContain("*6* - Falar com um atendente");
  });

  it("resolves option by key and label", () => {
    const root = getNode(defaultMenuFlow, "root");
    expect(resolveOption(root, "1")).toBe("hours");
    expect(resolveOption(root, "Horários de atendimento")).toBe("hours");
    expect(resolveOption(root, "99")).toBeNull();
  });
});

describe("MenuModel", () => {
  const model = new MenuModel();
  const ctx = {
    tenantId: "t1",
    instance: "demo",
    modelId: "menu" as const,
    sessionState: {},
    menuFlow: defaultMenuFlow,
  };

  it("starts at root menu", async () => {
    const result = await model.onStart(ctx, {
      phone: "5511999999999",
      text: "oi",
      messageType: "conversation",
    });
    expect(result.nextState).toEqual({ nodeId: "root" });
    expect(result.replies[0]?.text).toContain("Escolha uma opção");
  });

  it("navigates to hours and supports reset", async () => {
    const withRoot = {
      ...ctx,
      sessionState: { nodeId: "root" },
    };
    const hours = await model.handleMessage(withRoot, {
      phone: "5511999999999",
      text: "1",
      messageType: "conversation",
    });
    expect(hours.nextState).toEqual({ nodeId: "hours" });
    expect(hours.replies[0]?.text).toContain("09:00");

    const reset = await model.handleMessage(
      { ...ctx, sessionState: hours.nextState },
      { phone: "5511999999999", text: "menu", messageType: "conversation" },
    );
    expect(reset.nextState).toEqual({ nodeId: "root" });
  });

  it("hands off to catalog model", async () => {
    const result = await model.handleMessage(
      { ...ctx, sessionState: { nodeId: "root" } },
      { phone: "5511999999999", text: "3", messageType: "conversation" },
    );
    expect(result.nextModel).toBe("catalog");
  });

  it("hands off to leads model", async () => {
    const result = await model.handleMessage(
      { ...ctx, sessionState: { nodeId: "root" } },
      { phone: "5511999999999", text: "4", messageType: "conversation" },
    );
    expect(result.nextModel).toBe("leads");
    expect(result.nextState).toMatchObject({ origin: "menu" });
    expect(result.replies[0]?.text).toContain("registrar seus dados");
  });

  it("hands off to scheduling model", async () => {
    const result = await model.handleMessage(
      { ...ctx, sessionState: { nodeId: "root" } },
      { phone: "5511999999999", text: "5", messageType: "conversation" },
    );
    expect(result.nextModel).toBe("scheduling");
  });

  it("ends session on sair", async () => {
    const result = await model.handleMessage(
      { ...ctx, sessionState: { nodeId: "root" } },
      { phone: "5511999999999", text: "sair", messageType: "conversation" },
    );
    expect(result.endSession).toBe(true);
  });

  it("rejects invalid option", async () => {
    const result = await model.handleMessage(
      { ...ctx, sessionState: { nodeId: "root" } },
      { phone: "5511999999999", text: "9", messageType: "conversation" },
    );
    expect(result.replies[0]?.text).toContain("Opção inválida");
    expect(result.nextState).toEqual({ nodeId: "root" });
  });
});
