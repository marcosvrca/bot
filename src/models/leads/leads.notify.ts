import type { Lead } from "@prisma/client";
import type { Logger } from "../../config/logger.js";

export async function notifyLeadWebhook(params: {
  url: string | null | undefined;
  lead: Lead;
  tenantSlug?: string;
  logger: Logger;
}): Promise<void> {
  const url = params.url?.trim();
  if (!url) {
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "lead.created",
        tenantSlug: params.tenantSlug,
        lead: {
          id: params.lead.id,
          tenantId: params.lead.tenantId,
          phone: params.lead.phone,
          name: params.lead.name,
          email: params.lead.email,
          interest: params.lead.interest,
          city: params.lead.city,
          origin: params.lead.origin,
          status: params.lead.status,
          createdAt: params.lead.createdAt.toISOString(),
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      params.logger.warn(
        { status: res.status, url, leadId: params.lead.id },
        "leads.webhook.http_error",
      );
    }
  } catch (err) {
    params.logger.warn(
      { err, url, leadId: params.lead.id },
      "leads.webhook.failed",
    );
  }
}
