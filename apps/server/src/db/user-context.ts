import { AsyncLocalStorage } from "node:async_hooks";

export class DatabaseUserContext {
  readonly #storage = new AsyncLocalStorage<string | null>();

  public get userId(): string | null {
    return this.#storage.getStore() ?? null;
  }

  public clear(): void {
    this.#storage.enterWith(null);
  }

  public enter(userId: string): void {
    this.#storage.enterWith(userId);
  }
}
