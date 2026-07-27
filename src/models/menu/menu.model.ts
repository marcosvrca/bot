import type { BotModel, IncomingMessage, ModelContext, ModelResult } from "../types.js";
import { defaultMenuFlow, parseMenuFlow } from "./menu.flows.js";
import { getNode, renderNode, resolveOption } from "./menu.handlers.js";

type MenuState = {
  nodeId: string;
};

const RESET_COMMANDS = new Set(["menu", "inicio", "início", "start", "oi", "ola", "olá"]);
const EXIT_COMMANDS = new Set(["sair", "exit", "cancelar", "encerrar"]);

export class MenuModel implements BotModel {
  readonly id = "menu" as const;
  readonly capabilities = ["menu", "faq-static", "handoff"];

  async onStart(ctx: ModelContext, _message: IncomingMessage): Promise<ModelResult> {
    const flow = parseMenuFlow(ctx.menuFlow ?? defaultMenuFlow);
    const node = getNode(flow, flow.start);
    return {
      replies: [{ text: renderNode(node) }],
      nextState: { nodeId: node.id } satisfies MenuState,
    };
  }

  async handleMessage(ctx: ModelContext, message: IncomingMessage): Promise<ModelResult> {
    const flow = parseMenuFlow(ctx.menuFlow ?? defaultMenuFlow);
    const text = message.text.trim();
    const lower = text.toLowerCase();

    if (EXIT_COMMANDS.has(lower)) {
      return {
        replies: [{ text: "Atendimento encerrado. Quando quiser, envie *menu* para começar de novo." }],
        nextState: {},
        endSession: true,
      };
    }

    if (RESET_COMMANDS.has(lower) || !text) {
      return this.onStart(ctx, message);
    }

    const state = (ctx.sessionState as MenuState | undefined) ?? { nodeId: flow.start };
    const current = getNode(flow, state.nodeId ?? flow.start);

    if (current.type === "menu") {
      const nextId = resolveOption(current, text);
      if (!nextId) {
        return {
          replies: [
            {
              text: `Opção inválida.\n\n${renderNode(current)}`,
            },
          ],
          nextState: { nodeId: current.id },
        };
      }
      return this.enterNode(flow, nextId);
    }

    if (current.type === "message") {
      const nextId = current.next ?? flow.start;
      return this.enterNode(flow, nextId);
    }

    // handoff: stay until reset
    return {
      replies: [{ text: current.body }],
      nextState: { nodeId: current.id },
    };
  }

  private enterNode(flow: ReturnType<typeof parseMenuFlow>, nodeId: string): ModelResult {
    const node = getNode(flow, nodeId);
    return {
      replies: [{ text: renderNode(node) }],
      nextState: { nodeId: node.id },
    };
  }
}
