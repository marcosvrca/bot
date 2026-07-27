import type { OutboundMessage } from "../core/messaging/outbound-service.js";

export type BotModelId = "menu" | "scheduling" | "leads" | "catalog" | "ai";

export type IncomingMessage = {
  phone: string;
  text: string;
  pushName?: string;
  messageType: string;
};

export type ModelContext = {
  tenantId: string;
  instance: string;
  modelId: BotModelId;
  sessionState: Record<string, unknown>;
  menuFlow?: unknown;
};

export type ModelResult = {
  replies: OutboundMessage[];
  nextState: Record<string, unknown>;
  nextModel?: BotModelId;
  endSession?: boolean;
};

export interface BotModel {
  readonly id: BotModelId;
  readonly capabilities: string[];
  onStart(ctx: ModelContext, message: IncomingMessage): Promise<ModelResult>;
  handleMessage(ctx: ModelContext, message: IncomingMessage): Promise<ModelResult>;
}
