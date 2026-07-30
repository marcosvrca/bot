import { env } from "../../config/env.js";
import type { Logger } from "../../config/logger.js";

export type SendTextInput = {
  instance: string;
  phone: string;
  text: string;
};

export type ConnectionState = "open" | "close" | "connecting" | "unknown";

export type ChannelStatus = {
  instance: string;
  state: ConnectionState;
  exists: boolean;
  ownerJid?: string | null;
  profileName?: string | null;
};

export type ConnectResult = {
  instance: string;
  state: ConnectionState;
  qrcode?: string | null;
  pairingCode?: string | null;
  created?: boolean;
};

export class EvolutionClient {
  constructor(private readonly logger: Logger) {}

  private baseUrl(): string {
    return env().EVOLUTION_BASE_URL.replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      apikey: env().EVOLUTION_API_KEY,
    };
  }

  async sendText(input: SendTextInput): Promise<void> {
    const url = `${this.baseUrl()}/message/sendText/${encodeURIComponent(input.instance)}`;
    const number = normalizePhone(input.phone);

    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
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

  async getConnectionState(instance: string): Promise<ChannelStatus> {
    const url = `${this.baseUrl()}/instance/connectionState/${encodeURIComponent(instance)}`;
    const response = await fetch(url, { headers: this.headers() });

    if (response.status === 404) {
      return { instance, state: "unknown", exists: false };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      instance?: { instanceName?: string; state?: string };
      error?: string;
    };

    if (!response.ok) {
      // algumas versões retornam 400 se a instância não existe
      if (response.status === 400 || /not found|does not exist/i.test(payload.error ?? "")) {
        return { instance, state: "unknown", exists: false };
      }
      this.logger.warn(
        { status: response.status, payload, instance },
        "evolution.connectionState.failed",
      );
      throw new Error(`Evolution connectionState failed: ${response.status}`);
    }

    const state = normalizeState(payload.instance?.state);
    return { instance, state, exists: true };
  }

  async fetchInstanceInfo(instance: string): Promise<ChannelStatus> {
    const url = `${this.baseUrl()}/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`;
    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) {
      return this.getConnectionState(instance);
    }

    const payload = (await response.json().catch(() => [])) as unknown;
    const list = Array.isArray(payload) ? payload : [payload];
    const match = list.find((row) => {
      const r = row as {
        name?: string;
        instanceName?: string;
        instance?: { instanceName?: string; name?: string };
      };
      const name = r.name ?? r.instanceName ?? r.instance?.instanceName ?? r.instance?.name;
      return name === instance;
    }) as
      | {
          connectionStatus?: string;
          ownerJid?: string;
          profileName?: string;
          instance?: {
            connectionStatus?: string;
            ownerJid?: string;
            profileName?: string;
          };
        }
      | undefined;

    if (!match) {
      return this.getConnectionState(instance);
    }

    const state = normalizeState(
      match.connectionStatus ?? match.instance?.connectionStatus,
    );
    return {
      instance,
      state,
      exists: true,
      ownerJid: match.ownerJid ?? match.instance?.ownerJid ?? null,
      profileName: match.profileName ?? match.instance?.profileName ?? null,
    };
  }

  async createInstance(instance: string): Promise<ConnectResult> {
    const url = `${this.baseUrl()}/instance/create`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        instanceName: instance,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      // já existe
      if (response.status === 403 || response.status === 409) {
        return { instance, state: "close", created: false };
      }
      this.logger.error({ status: response.status, payload, instance }, "evolution.create.failed");
      throw new Error(
        `Não foi possível criar a instância na Evolution (${response.status}).`,
      );
    }

    const qrcode = extractQrBase64(payload);
    return {
      instance,
      state: qrcode ? "connecting" : "close",
      qrcode,
      created: true,
    };
  }

  async connect(instance: string): Promise<ConnectResult> {
    const url = `${this.baseUrl()}/instance/connect/${encodeURIComponent(instance)}`;
    const response = await fetch(url, { headers: this.headers() });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (response.status === 404) {
      return { instance, state: "unknown", qrcode: null };
    }

    if (!response.ok) {
      this.logger.warn({ status: response.status, payload, instance }, "evolution.connect.failed");
      throw new Error(`Evolution connect failed: ${response.status}`);
    }

    return {
      instance,
      state: "connecting",
      qrcode: extractQrBase64(payload),
      pairingCode:
        typeof payload.pairingCode === "string" ? payload.pairingCode : null,
    };
  }

  async setWebhook(instance: string, webhookUrl: string, secret: string): Promise<void> {
    const url = `${this.baseUrl()}/webhook/set/${encodeURIComponent(instance)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          headers: { "x-webhook-secret": secret },
          byEvents: false,
          base64: false,
          events: ["MESSAGES_UPSERT"],
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.error(
        { status: response.status, body, instance, webhookUrl },
        "evolution.webhook.set.failed",
      );
      throw new Error(`Falha ao configurar webhook da Evolution (${response.status}).`);
    }

    this.logger.info({ instance, webhookUrl }, "evolution.webhook.set.ok");
  }

  async logout(instance: string): Promise<void> {
    const url = `${this.baseUrl()}/instance/logout/${encodeURIComponent(instance)}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!response.ok && response.status !== 404) {
      const body = await response.text().catch(() => "");
      this.logger.warn({ status: response.status, body, instance }, "evolution.logout.failed");
      throw new Error(`Falha ao desconectar a instância (${response.status}).`);
    }
  }

  /**
   * Garante instância + webhook e devolve QR quando necessário.
   */
  async ensureConnectedWithQr(instance: string): Promise<ConnectResult & ChannelStatus> {
    let status = await this.fetchInstanceInfo(instance);

    if (!status.exists) {
      const created = await this.createInstance(instance);
      await this.configureTenantWebhook(instance);
      if (created.qrcode) {
        return { ...created, exists: true, state: created.state };
      }
      status = await this.fetchInstanceInfo(instance);
    } else {
      await this.configureTenantWebhook(instance);
    }

    if (status.state === "open") {
      return { ...status, qrcode: null };
    }

    const connected = await this.connect(instance);
    // se connect não trouxe QR (já conectando), tenta create path já coberto
    if (!connected.qrcode && status.exists === false) {
      const created = await this.createInstance(instance);
      return { ...status, ...created, exists: true };
    }

    return {
      ...status,
      ...connected,
      exists: true,
      state: connected.qrcode ? "connecting" : status.state,
    };
  }

  async configureTenantWebhook(instance: string): Promise<void> {
    const webhookUrl = env().WEBHOOK_PUBLIC_URL;
    await this.setWebhook(instance, webhookUrl, env().WEBHOOK_SECRET);
  }
}

export function normalizePhone(raw: string): string {
  return raw.replace(/@.+$/, "").replace(/\D/g, "");
}

function normalizeState(raw?: string | null): ConnectionState {
  const value = (raw ?? "").toLowerCase();
  if (value === "open" || value === "connected") return "open";
  if (value === "connecting" || value === "qrcode") return "connecting";
  if (value === "close" || value === "closed" || value === "disconnected") return "close";
  return "unknown";
}

function extractQrBase64(payload: Record<string, unknown>): string | null {
  const direct = payload.base64;
  if (typeof direct === "string" && direct.length > 0) {
    return direct.startsWith("data:") ? direct : `data:image/png;base64,${direct}`;
  }

  const qr = payload.qrcode;
  if (qr && typeof qr === "object") {
    const base64 = (qr as { base64?: string }).base64;
    if (typeof base64 === "string" && base64.length > 0) {
      return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
    }
  }

  return null;
}
