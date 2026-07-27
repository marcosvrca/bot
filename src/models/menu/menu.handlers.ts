import type { MenuFlow, MenuNode } from "./menu.flows.js";

export function renderNode(node: MenuNode): string {
  if (node.type === "menu") {
    const lines = [node.title];
    if (node.body) {
      lines.push(node.body);
    }
    lines.push("");
    for (const option of node.options) {
      lines.push(`*${option.key}* - ${option.label}`);
    }
    lines.push("");
    lines.push("_Digite o número da opção, *menu* para recomeçar ou *sair* para encerrar._");
    return lines.join("\n");
  }

  if (node.type === "message") {
    const lines = [`*${node.title}*`, node.body];
    if (node.next) {
      lines.push("");
      lines.push("_Digite *menu* para voltar ou qualquer mensagem para continuar._");
    }
    return lines.join("\n");
  }

  return [`*${node.title}*`, node.body].join("\n");
}

export function resolveOption(node: MenuNode, input: string): string | null {
  if (node.type !== "menu") {
    return null;
  }
  const normalized = input.trim().toLowerCase();
  const byKey = node.options.find((o) => o.key.toLowerCase() === normalized);
  if (byKey) {
    return byKey.next;
  }
  const byLabel = node.options.find(
    (o) => o.label.toLowerCase() === normalized || o.label.toLowerCase().includes(normalized),
  );
  return byLabel?.next ?? null;
}

export function getNode(flow: MenuFlow, nodeId: string): MenuNode {
  const node = flow.nodes[nodeId];
  if (!node) {
    throw new Error(`Menu node not found: ${nodeId}`);
  }
  return node;
}
