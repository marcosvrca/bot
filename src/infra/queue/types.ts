export const QUEUE_NAMES = {
  inboundMessages: "inbound-messages",
} as const;

export type InboundMessageJob = {
  eventId: string;
  instance: string;
  phone: string;
  text: string;
  messageType: string;
  pushName?: string;
  raw: unknown;
  receivedAt: string;
};
