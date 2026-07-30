/**
 * Seed do produto Fisioterapia Domiciliar (tenant separado do demo).
 *
 * Uso:
 *   FISIO_OWNER_PHONE=5511999999999 npx tsx prisma/seed-fisio.ts
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { fisioCatalog, fisioMenuFlow } from "../src/products/fisio/fisio.config.js";

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.FISIO_TENANT_SLUG ?? "fisio";
  const instance = process.env.FISIO_EVOLUTION_INSTANCE ?? "fisio";
  const ownerPhone = (process.env.FISIO_OWNER_PHONE ?? "").replace(/\D/g, "");
  const menuFlowJson = fisioMenuFlow as unknown as Prisma.InputJsonValue;
  const activeModels = ["menu", "catalog", "scheduling", "leads"];

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: {
      name: "Fisio Domiciliar",
      slug,
      active: true,
      config: {
        create: {
          evolutionInstance: instance,
          activeModels,
          defaultModel: "menu",
          menuFlow: menuFlowJson,
          ownerPhones: ownerPhone ? [ownerPhone] : [],
        },
      },
    },
    update: {
      name: "Fisio Domiciliar",
      active: true,
      config: {
        upsert: {
          create: {
            evolutionInstance: instance,
            activeModels,
            defaultModel: "menu",
            menuFlow: menuFlowJson,
            ownerPhones: ownerPhone ? [ownerPhone] : [],
          },
          update: {
            evolutionInstance: instance,
            activeModels,
            defaultModel: "menu",
            menuFlow: menuFlowJson,
            ...(ownerPhone ? { ownerPhones: [ownerPhone] } : {}),
          },
        },
      },
    },
  });

  for (const item of fisioCatalog) {
    const existing = await prisma.catalogItem.findFirst({
      where: { tenantId: tenant.id, sku: item.sku },
    });
    if (existing) {
      await prisma.catalogItem.update({
        where: { id: existing.id },
        data: { ...item, active: true },
      });
    } else {
      await prisma.catalogItem.create({
        data: { tenantId: tenant.id, ...item, active: true },
      });
    }
  }

  console.log(
    [
      `Seed fisio OK`,
      `  tenant: ${slug}`,
      `  instance Evolution: ${instance}`,
      `  owner admin: ${ownerPhone || "(defina FISIO_OWNER_PHONE)"}`,
      `  catálogo: ${fisioCatalog.length} serviços`,
      ``,
      `Dono no WhatsApp digita: admin`,
      `Paciente conversa normalmente no menu.`,
    ].join("\n"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
