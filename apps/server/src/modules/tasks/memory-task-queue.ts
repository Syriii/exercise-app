import { randomUUID } from "node:crypto";
import type { QueueDefinition, TaskQueue } from "./task-queue.js";

export class MemoryTaskQueue implements TaskQueue {
  readonly #handlers = new Map<string, (taskId: string) => Promise<void>>();
  readonly #pending = new Map<string, string[]>();
  public async start() {}
  public async stop() {}
  public async ensureQueue(_definition: QueueDefinition) {}
  public async enqueue(queueName: string, taskId: string) { const id = randomUUID(); const handler = this.#handlers.get(queueName); if (handler === undefined) this.#pending.set(queueName, [...(this.#pending.get(queueName) ?? []), taskId]); else queueMicrotask(() => void handler(taskId)); return id; }
  public async work(queueName: string, handler: (taskId: string) => Promise<void>) { this.#handlers.set(queueName, handler); for (const taskId of this.#pending.get(queueName) ?? []) queueMicrotask(() => void handler(taskId)); this.#pending.delete(queueName); }
}
