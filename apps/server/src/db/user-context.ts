import { AsyncLocalStorage } from "node:async_hooks";

export class DatabaseUserContext {
  readonly #storage = new AsyncLocalStorage<string | null>();

  public get userId(): string | null {
    return this.#storage.getStore() ?? null;
  }

  public run<T>(userId: string | null, callback: () => T): T {
    return this.#storage.run(userId, callback);
  }
}
