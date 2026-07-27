import type { BotModel, BotModelId } from "./types.js";

export class ModelRegistry {
  private readonly models = new Map<BotModelId, BotModel>();

  register(model: BotModel): void {
    this.models.set(model.id, model);
  }

  get(id: BotModelId): BotModel {
    const model = this.models.get(id);
    if (!model) {
      throw new Error(`Bot model not registered: ${id}`);
    }
    return model;
  }

  has(id: string): id is BotModelId {
    return this.models.has(id as BotModelId);
  }

  list(): BotModelId[] {
    return [...this.models.keys()];
  }
}
