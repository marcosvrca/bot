import { z } from "zod";
import { normalizePhone } from "../messaging/evolution-client.js";

const evolutionWebhookSchema = z.object({
  event: z.string().optional(),
  instance: z.string().optional(),
  data: z.unknown().optional(),
}).passthrough();

export type ParsedInbound = {
  eventId: string;
  instance: string;
  phone: string;
  text: string;
  messageType: string;
  pushName?: string;
  raw: unknown;
};

export function parseEvolutionWebhook(payload: unknown): ParsedInbound | null {
  const parsed = evolutionWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  const body = parsed.data as Record<string, unknown>;
  const event = String(body.event ?? body.Event ?? "");
  if (event && !event.toLowerCase().includes("messages.upsert")) {
    // Allow missing event (some setups) but skip known non-message events
    if (event.length > 0 && !/message/i.test(event)) {
      return null;
    }
  }

  const data = (body.data ?? body) as Record<string, unknown>;
  const key = (data.key ?? {}) as Record<string, unknown>;
  const fromMe = Boolean(key.fromMe);
  if (fromMe) {
    return null;
  }

  const remoteJid = String(key.remoteJid ?? data.remoteJid ?? "");
  if (!remoteJid || remoteJid.endsWith("@g.us")) {
    return null;
  }

  const message = (data.message ?? {}) as Record<string, unknown>;
  const messageType = String(data.messageType ?? detectMessageType(message));
  const text = extractText(message, data);
  if (!text) {
    return null;
  }

  const instance = String(
    body.instance ?? data.instance ?? (body as { instanceName?: string }).instanceName ?? "",
  );
  if (!instance) {
    return null;
  }

  const eventId =
    String(key.id ?? data.id ?? "") ||
    `${instance}:${remoteJid}:${text}:${String(data.messageTimestamp ?? Date.now())}`;

  return {
    eventId,
    instance,
    phone: normalizePhone(remoteJid),
    text: text.trim(),
    messageType,
    pushName: data.pushName ? String(data.pushName) : undefined,
    raw: payload,
  };
}

function detectMessageType(message: Record<string, unknown>): string {
  if (message.conversation || message.extendedTextMessage) return "conversation";
  if (message.imageMessage) return "imageMessage";
  if (message.audioMessage) return "audioMessage";
  if (message.buttonsResponseMessage || message.listResponseMessage) return "interactive";
  return "unknown";
}

function extractText(
  message: Record<string, unknown>,
  data: Record<string, unknown>,
): string | null {
  if (typeof message.conversation === "string") {
    return message.conversation;
  }

  const extended = message.extendedTextMessage as { text?: string } | undefined;
  if (extended?.text) {
    return extended.text;
  }

  const buttons = message.buttonsResponseMessage as { selectedDisplayText?: string; selectedButtonId?: string } | undefined;
  if (buttons?.selectedDisplayText || buttons?.selectedButtonId) {
    return buttons.selectedDisplayText ?? buttons.selectedButtonId ?? null;
  }

  const list = message.listResponseMessage as { title?: string; singleSelectReply?: { selectedRowId?: string } } | undefined;
  if (list?.title || list?.singleSelectReply?.selectedRowId) {
    return list.title ?? list.singleSelectReply?.selectedRowId ?? null;
  }

  if (typeof data.body === "string") {
    return data.body;
  }

  return null;
}
