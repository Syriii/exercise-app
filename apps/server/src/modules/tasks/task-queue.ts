export interface QueueDefinition {
  readonly name: string;
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly retryBackoff: boolean;
  readonly expireInSeconds: number;
  readonly heartbeatSeconds: number;
  readonly deleteAfterSeconds: number;
}

export interface TaskQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  ensureQueue(definition: QueueDefinition): Promise<void>;
  enqueue(queueName: string, taskId: string): Promise<string>;
  work(
    queueName: string,
    handler: (taskId: string) => Promise<void>,
    options?: { readonly concurrency?: number },
  ): Promise<void>;
}
