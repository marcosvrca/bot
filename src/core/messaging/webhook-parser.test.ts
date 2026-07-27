import { describe, expect, it } from "vitest";
import { parseEvolutionWebhook } from "./webhook-parser.js";

describe("parseEvolutionWebhook", () => {
  it("parses text messages and skips fromMe", () => {
    const inbound = parseEvolutionWebhook({
      event: "messages.upsert",
      instance: "demo",
      data: {
        key: {
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false,
          id: "ABC123",
        },
        pushName: "Teste",
        message: { conversation: "oi" },
        messageType: "conversation",
      },
    });

    expect(inbound).toMatchObject({
      eventId: "ABC123",
      instance: "demo",
      phone: "5511999999999",
      text: "oi",
    });
  });

  it("ignores group and fromMe messages", () => {
    expect(
      parseEvolutionWebhook({
        event: "messages.upsert",
        instance: "demo",
        data: {
          key: { remoteJid: "120363@g.us", fromMe: false, id: "1" },
          message: { conversation: "oi" },
        },
      }),
    ).toBeNull();

    expect(
      parseEvolutionWebhook({
        event: "messages.upsert",
        instance: "demo",
        data: {
          key: {
            remoteJid: "5511999999999@s.whatsapp.net",
            fromMe: true,
            id: "2",
          },
          message: { conversation: "oi" },
        },
      }),
    ).toBeNull();
  });
});
