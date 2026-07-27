import { env } from "../../config/env.js";
import type { Logger } from "../../config/logger.js";

export type SendTextInput = {
  instance: string;
  phone: string;
  text: string;
};

export class EvolutionClient {
  constructor(private readonly logger: Logger) {}

  async sendText(input: SendTextInput): Promise<void> {
    const base = env().EVOLUTION_BASE_URL.replace(/\/$/, "");
    const url = `${base}/message/sendText/${encodeURIComponent(input.instance)}`;
    const number = normalizePhone(input.phone);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env().EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        number,
        text: input.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.error(
        { status: response.status, body, instance: input.instance, number },
        "evolution.sendText.failed",
      );
      throw new Error(`Evolution sendText failed: ${response.status}`);
    }

    this.logger.info(
      { instance: input.instance, number, chars: input.text.length },
      "evolution.sendText.ok",
    );
  }
}

export function normalizePhone(raw: string): string {
  return raw.replace(/@.+$/, "").replace(/\D/g, "");
}
