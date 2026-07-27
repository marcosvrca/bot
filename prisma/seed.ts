import { PrismaClient } from "@prisma/client";
import { defaultMenuFlow } from "../src/models/menu/menu.flows.js";

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.DEMO_TENANT_SLUG ?? "demo";
  const instance = process.env.DEMO_EVOLUTION_INSTANCE ?? "demo";

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: {
      name: "Demo Tenant",
      slug,
      active: true,
      config: {
        create: {
          evolutionInstance: instance,
          activeModels: ["menu"],
          defaultModel: "menu",
          menuFlow: defaultMenuFlow,
        },
      },
    },
    update: {
      active: true,
      config: {
        upsert: {
          create: {
            evolutionInstance: instance,
            activeModels: ["menu"],
            defaultModel: "menu",
            menuFlow: defaultMenuFlow,
          },
          update: {
            evolutionInstance: instance,
            activeModels: ["menu"],
            defaultModel: "menu",
            menuFlow: defaultMenuFlow,
          },
        },
      },
    },
    include: { config: true },
  });

  console.log(`Seeded tenant "${tenant.slug}" -> instance "${instance}"`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
