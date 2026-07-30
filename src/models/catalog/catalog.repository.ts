import type { CatalogItem, PrismaClient } from "@prisma/client";

export class CatalogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  listActive(tenantId: string, limit = 30): Promise<CatalogItem[]> {
    return this.prisma.catalogItem.findMany({
      where: { tenantId, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: Math.min(Math.max(limit, 1), 50),
    });
  }

  listCategories(tenantId: string): Promise<string[]> {
    return this.prisma.catalogItem
      .findMany({
        where: { tenantId, active: true, category: { not: null } },
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
      })
      .then((rows) =>
        rows.map((r) => r.category).filter((c): c is string => Boolean(c)),
      );
  }

  listByCategory(tenantId: string, category: string): Promise<CatalogItem[]> {
    return this.prisma.catalogItem.findMany({
      where: {
        tenantId,
        active: true,
        category: { equals: category, mode: "insensitive" },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 50,
    });
  }

  search(tenantId: string, query: string): Promise<CatalogItem[]> {
    const q = query.trim();
    if (!q) {
      return this.listActive(tenantId);
    }
    return this.prisma.catalogItem.findMany({
      where: {
        tenantId,
        active: true,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 20,
    });
  }

  findById(tenantId: string, id: string): Promise<CatalogItem | null> {
    return this.prisma.catalogItem.findFirst({
      where: { id, tenantId, active: true },
    });
  }

  findOwned(tenantId: string, id: string): Promise<CatalogItem | null> {
    return this.prisma.catalogItem.findFirst({
      where: { id, tenantId },
    });
  }

  listAll(tenantId: string, limit = 100): Promise<CatalogItem[]> {
    return this.prisma.catalogItem.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  create(input: {
    tenantId: string;
    name: string;
    description?: string | null;
    priceCents: number;
    sku?: string | null;
    category?: string | null;
    sortOrder?: number;
    active?: boolean;
  }): Promise<CatalogItem> {
    return this.prisma.catalogItem.create({
      data: {
        tenantId: input.tenantId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        priceCents: input.priceCents,
        sku: input.sku?.trim() || null,
        category: input.category?.trim() || null,
        sortOrder: input.sortOrder ?? 0,
        active: input.active ?? true,
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      priceCents?: number;
      sku?: string | null;
      category?: string | null;
      sortOrder?: number;
      active?: boolean;
    },
  ): Promise<CatalogItem | null> {
    const existing = await this.findOwned(tenantId, id);
    if (!existing) return null;
    return this.prisma.catalogItem.update({
      where: { id },
      data: {
        name: patch.name?.trim(),
        description:
          patch.description === undefined
            ? undefined
            : patch.description?.trim() || null,
        priceCents: patch.priceCents,
        sku: patch.sku === undefined ? undefined : patch.sku?.trim() || null,
        category:
          patch.category === undefined ? undefined : patch.category?.trim() || null,
        sortOrder: patch.sortOrder,
        active: patch.active,
      },
    });
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const existing = await this.findOwned(tenantId, id);
    if (!existing) return false;
    await this.prisma.catalogItem.delete({ where: { id } });
    return true;
  }
}

export function formatPriceBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatCatalogItem(item: CatalogItem, index?: number): string {
  const prefix = index !== undefined ? `*${index}.* ` : "";
  const lines = [
    `${prefix}*${item.name}* — ${formatPriceBRL(item.priceCents)}`,
  ];
  if (item.category) {
    lines.push(`📁 ${item.category}`);
  }
  if (item.sku) {
    lines.push(`SKU: ${item.sku}`);
  }
  return lines.join("\n");
}

export function formatCatalogDetail(item: CatalogItem): string {
  const lines = [
    `*${item.name}*`,
    `💰 ${formatPriceBRL(item.priceCents)}`,
  ];
  if (item.category) lines.push(`📁 ${item.category}`);
  if (item.sku) lines.push(`SKU: ${item.sku}`);
  if (item.description) {
    lines.push("", item.description);
  }
  lines.push(
    "",
    "_Digite *quero* para registrar interesse, *lista* para voltar ou *menu* para o início._",
  );
  return lines.join("\n");
}
