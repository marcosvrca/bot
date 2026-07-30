import type { PrismaClient } from "@prisma/client";
import type {
  BotModel,
  IncomingMessage,
  ModelContext,
  ModelResult,
} from "../types.js";
import {
  CatalogRepository,
  formatCatalogDetail,
  formatCatalogItem,
} from "./catalog.repository.js";

type Step = "idle" | "search" | "pick" | "category_pick" | "detail";

type CatalogState = {
  step: Step;
  candidates?: string[];
  categories?: string[];
  selectedId?: string;
};

const EXIT = new Set(["sair", "exit", "cancelar", "encerrar"]);
const MENU = new Set(["menu", "inicio", "início", "voltar"]);
const HELP = new Set(["ajuda", "help", "?"]);
const HOME = new Set(["0", "lista", "home", "catalogo", "catálogo"]);
const GREET = new Set(["oi", "ola", "olá", "oie", "hey", "start", "bom dia", "boa tarde", "boa noite"]);

export class CatalogModel implements BotModel {
  readonly id = "catalog" as const;
  readonly capabilities = ["catalog", "price-list", "product-search", "lead-interest"];

  private readonly repo: CatalogRepository;

  constructor(prisma: PrismaClient) {
    this.repo = new CatalogRepository(prisma);
  }

  async onStart(ctx: ModelContext, message: IncomingMessage): Promise<ModelResult> {
    const text = message.text.trim().toLowerCase();
    if (
      text &&
      !MENU.has(text) &&
      !HELP.has(text) &&
      !HOME.has(text) &&
      !GREET.has(text)
    ) {
      return this.handleMessage(
        { ...ctx, sessionState: { step: "idle" } },
        message,
      );
    }
    return this.home();
  }

  async handleMessage(ctx: ModelContext, message: IncomingMessage): Promise<ModelResult> {
    const text = message.text.trim();
    const lower = text.toLowerCase();
    const state = (ctx.sessionState as CatalogState | undefined) ?? { step: "idle" };

    if (EXIT.has(lower)) {
      return {
        replies: [
          {
            text: "Catálogo encerrado. Envie *modelo catalogo* ou *menu* para voltar.",
          },
        ],
        nextState: {},
        endSession: true,
      };
    }

    if (MENU.has(lower)) {
      return {
        replies: [{ text: "Voltando ao menu…" }],
        nextState: {},
        nextModel: "menu",
      };
    }

    if (HELP.has(lower) || HOME.has(lower)) {
      return this.home();
    }

    switch (state.step) {
      case "search":
        return this.onSearch(ctx, text);
      case "pick":
        return this.onPick(ctx, state, text);
      case "category_pick":
        return this.onCategoryPick(ctx, state, text);
      case "detail":
        return this.onDetail(ctx, state, lower, text);
      case "idle":
      default:
        return this.routeIdle(ctx, text, lower);
    }
  }

  private home(): ModelResult {
    return {
      replies: [
        {
          text: [
            "*🛒 Catálogo*",
            "",
            "Escolha uma opção:",
            "*1* - Ver produtos",
            "*2* - Buscar produto",
            "*3* - Ver por categoria",
            "*4* - Quero orçamento / interesse",
            "",
            "_Digite *ajuda*, *menu* para o hub ou *sair* para encerrar._",
          ].join("\n"),
        },
      ],
      nextState: { step: "idle" } satisfies CatalogState,
    };
  }

  private async routeIdle(
    ctx: ModelContext,
    text: string,
    lower: string,
  ): Promise<ModelResult> {
    if (["1", "produtos", "lista", "ver", "catalogo", "catálogo"].includes(lower)) {
      return this.showList(ctx);
    }
    if (["2", "buscar", "pesquisa", "pesquisar"].includes(lower)) {
      return {
        replies: [
          {
            text: "O que você procura?\nEx.: `bateria`, `consultoria`, `SKU-01`",
          },
        ],
        nextState: { step: "search" },
      };
    }
    if (["3", "categoria", "categorias"].includes(lower)) {
      return this.showCategories(ctx);
    }
    if (["4", "orcamento", "orçamento", "interesse", "quero"].includes(lower)) {
      return {
        replies: [{ text: "Vamos registrar seu interesse…" }],
        nextState: { origin: "catalog", interest: "Catálogo" },
        nextModel: "leads",
      };
    }

    // Atalho: texto livre busca direto
    if (text.length >= 2) {
      return this.onSearch(ctx, text);
    }

    return {
      replies: [
        {
          text: `Não entendi.\n\n${(await this.home()).replies[0]?.text}`,
        },
      ],
      nextState: { step: "idle" },
    };
  }

  private async showList(ctx: ModelContext): Promise<ModelResult> {
    const items = await this.repo.listActive(ctx.tenantId);
    if (items.length === 0) {
      return {
        replies: [
          {
            text: "Nenhum produto cadastrado neste catálogo ainda.",
          },
        ],
        nextState: { step: "idle" },
      };
    }
    const body = items.map((item, i) => formatCatalogItem(item, i + 1)).join("\n\n");
    return {
      replies: [
        {
          text: [
            `*Produtos (${items.length})*`,
            "",
            body,
            "",
            "_Digite o *número* do produto para ver detalhes._",
          ].join("\n"),
        },
      ],
      nextState: {
        step: "pick",
        candidates: items.map((i) => i.id),
      } satisfies CatalogState,
    };
  }

  private async showCategories(ctx: ModelContext): Promise<ModelResult> {
    const categories = await this.repo.listCategories(ctx.tenantId);
    if (categories.length === 0) {
      return {
        replies: [
          {
            text: "Não há categorias cadastradas. Use *1* para ver todos os produtos.",
          },
        ],
        nextState: { step: "idle" },
      };
    }
    const body = categories.map((c, i) => `*${i + 1}* - ${c}`).join("\n");
    return {
      replies: [
        {
          text: `*Categorias*\n\n${body}\n\n_Digite o número da categoria._`,
        },
      ],
      nextState: {
        step: "category_pick",
        categories,
      } satisfies CatalogState,
    };
  }

  private async onSearch(ctx: ModelContext, query: string): Promise<ModelResult> {
    const items = await this.repo.search(ctx.tenantId, query);
    if (items.length === 0) {
      return {
        replies: [
          {
            text: `Nada encontrado para "${query}".\nTente outro termo ou digite *1* para ver a lista.`,
          },
        ],
        nextState: { step: "idle" },
      };
    }
    if (items.length === 1) {
      const item = items[0]!;
      return {
        replies: [{ text: formatCatalogDetail(item) }],
        nextState: {
          step: "detail",
          selectedId: item.id,
          candidates: [item.id],
        },
      };
    }
    const body = items.map((item, i) => formatCatalogItem(item, i + 1)).join("\n\n");
    return {
      replies: [
        {
          text: `Resultados para *${query}*:\n\n${body}\n\n_Digite o número._`,
        },
      ],
      nextState: {
        step: "pick",
        candidates: items.map((i) => i.id),
      },
    };
  }

  private async onPick(
    ctx: ModelContext,
    state: CatalogState,
    text: string,
  ): Promise<ModelResult> {
    if (text.trim() === "0") {
      return this.home();
    }
    const idx = Number(text.trim());
    const candidates = state.candidates ?? [];
    if (!Number.isInteger(idx) || idx < 1 || idx > candidates.length) {
      return {
        replies: [
          {
            text: `Digite um número de 1 a ${candidates.length}, ou *0* para o menu do catálogo.`,
          },
        ],
        nextState: state,
      };
    }
    const id = candidates[idx - 1]!;
    const item = await this.repo.findById(ctx.tenantId, id);
    if (!item) {
      return {
        replies: [{ text: "Produto indisponível. Digite *1* para atualizar a lista." }],
        nextState: { step: "idle" },
      };
    }
    return {
      replies: [{ text: formatCatalogDetail(item) }],
      nextState: {
        step: "detail",
        selectedId: item.id,
        candidates,
      },
    };
  }

  private async onCategoryPick(
    ctx: ModelContext,
    state: CatalogState,
    text: string,
  ): Promise<ModelResult> {
    if (text.trim() === "0") {
      return this.home();
    }
    const idx = Number(text.trim());
    const categories = state.categories ?? [];
    if (!Number.isInteger(idx) || idx < 1 || idx > categories.length) {
      return {
        replies: [
          {
            text: `Digite um número de 1 a ${categories.length}, ou *0* para voltar.`,
          },
        ],
        nextState: state,
      };
    }
    const category = categories[idx - 1]!;
    const items = await this.repo.listByCategory(ctx.tenantId, category);
    if (items.length === 0) {
      return {
        replies: [{ text: `Nenhum produto em *${category}*.` }],
        nextState: { step: "idle" },
      };
    }
    const body = items.map((item, i) => formatCatalogItem(item, i + 1)).join("\n\n");
    return {
      replies: [
        {
          text: `*${category}* (${items.length})\n\n${body}\n\n_Digite o número do produto._`,
        },
      ],
      nextState: {
        step: "pick",
        candidates: items.map((i) => i.id),
      },
    };
  }

  private async onDetail(
    ctx: ModelContext,
    state: CatalogState,
    lower: string,
    _text: string,
  ): Promise<ModelResult> {
    if (["quero", "interesse", "orcamento", "orçamento", "comprar", "sim"].includes(lower)) {
      const item = state.selectedId
        ? await this.repo.findById(ctx.tenantId, state.selectedId)
        : null;
      const interest = item?.name ?? "Produto do catálogo";
      return {
        replies: [
          {
            text: `Ótimo! Vamos registrar seu interesse em *${interest}*.`,
          },
        ],
        nextState: { origin: "catalog", interest },
        nextModel: "leads",
      };
    }

    if (["1", "produtos", "lista"].includes(lower)) {
      return this.showList(ctx);
    }

    // número enquanto em detalhe → tentar pick na lista anterior
    if (/^\d+$/.test(lower) && state.candidates?.length) {
      return this.onPick(ctx, { ...state, step: "pick" }, lower);
    }

    return {
      replies: [
        {
          text: "Digite *quero* para interesse, *lista* para produtos ou *menu* para o início.",
        },
      ],
      nextState: state,
    };
  }
}
