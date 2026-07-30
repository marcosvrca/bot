import type { Lead, Prisma, PrismaClient } from "@prisma/client";

export type CreateLeadInput = {
  tenantId: string;
  phone: string;
  name: string;
  email?: string | null;
  interest?: string | null;
  city?: string | null;
  origin?: string;
  notes?: string | null;
  meta?: Prisma.InputJsonValue;
};

export class LeadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(input: CreateLeadInput): Promise<Lead> {
    return this.prisma.lead.create({
      data: {
        tenantId: input.tenantId,
        phone: input.phone,
        name: input.name,
        email: input.email ?? null,
        interest: input.interest ?? null,
        city: input.city ?? null,
        origin: input.origin ?? "whatsapp",
        notes: input.notes ?? null,
        meta: input.meta,
        status: "new",
      },
    });
  }

  listByTenant(tenantId: string, limit = 50): Promise<Lead[]> {
    return this.prisma.lead.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async update(
    tenantId: string,
    id: string,
    patch: {
      name?: string;
      email?: string | null;
      interest?: string | null;
      city?: string | null;
      status?: string;
      notes?: string | null;
    },
  ): Promise<Lead | null> {
    const existing = await this.prisma.lead.findFirst({ where: { id, tenantId } });
    if (!existing) return null;
    return this.prisma.lead.update({
      where: { id },
      data: {
        name: patch.name?.trim(),
        email: patch.email === undefined ? undefined : patch.email?.trim() || null,
        interest:
          patch.interest === undefined ? undefined : patch.interest?.trim() || null,
        city: patch.city === undefined ? undefined : patch.city?.trim() || null,
        status: patch.status?.trim(),
        notes: patch.notes === undefined ? undefined : patch.notes?.trim() || null,
      },
    });
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const existing = await this.prisma.lead.findFirst({ where: { id, tenantId } });
    if (!existing) return false;
    await this.prisma.lead.delete({ where: { id } });
    return true;
  }
}

export function formatLeadSummary(lead: Lead): string {
  const lines = [
    `*Lead #${lead.id.slice(-6)}*`,
    `Nome: ${lead.name}`,
    `Telefone: ${lead.phone}`,
  ];
  if (lead.email) lines.push(`E-mail: ${lead.email}`);
  if (lead.interest) lines.push(`Interesse: ${lead.interest}`);
  if (lead.city) lines.push(`Cidade: ${lead.city}`);
  lines.push(`Origem: ${lead.origin}`);
  return lines.join("\n");
}
