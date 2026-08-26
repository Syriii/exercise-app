import { statfs } from "node:fs/promises";

import { desc, eq, sql } from "drizzle-orm";

import type { Database } from "../../db/database.js";
import { backgroundTasks, maintenanceEvents, runtimeHeartbeats, temporaryMedia } from "../../db/schema/index.js";

export type RuntimeHealthStatus = "healthy" | "stale" | "unavailable" | "unknown";

export interface ComponentHealth {
  readonly status: RuntimeHealthStatus;
  readonly lastSeenAt: string | null;
}

export interface OperationsHealth {
  readonly checkedAt: string;
  readonly api: ComponentHealth;
  readonly database: ComponentHealth;
  readonly worker: ComponentHealth;
}

export interface OperationsHealthReader {
  getHealth(): Promise<OperationsHealth>;
}

export interface OperationsSummary {
  readonly checkedAt: string;
  readonly model: { readonly configured: boolean; readonly model: string | null };
  readonly tasks: Readonly<Record<"pending" | "running" | "succeeded" | "failed" | "cancelled", number>>;
  readonly media: Readonly<Record<"available" | "deletion_pending" | "deleted" | "missing", number>> & { readonly expiredAvailable: number };
  readonly disk: { readonly availableBytes: number | null };
  readonly backup: { readonly lastSucceededAt: string | null; readonly lastFailedAt: string | null };
  readonly restoreVerification: { readonly lastSucceededAt: string | null; readonly lastFailedAt: string | null };
}

export interface OperationsSummaryReader {
  getSummary(): Promise<OperationsSummary>;
}

export interface WorkerHeartbeatWriter {
  recordWorkerHeartbeat(instanceId: string, startedAt: Date): Promise<void>;
}

export interface PostgresOperationsServiceOptions {
  readonly database: Database;
  readonly checkDatabase: () => Promise<void>;
  readonly workerStaleAfterSeconds: number;
  readonly now?: () => Date;
  readonly modelConfigured?: boolean;
  readonly modelName?: string | null;
  readonly mediaRoot?: string | null;
}

export class PostgresOperationsService
  implements OperationsHealthReader, OperationsSummaryReader, WorkerHeartbeatWriter
{
  readonly #database: Database;
  readonly #checkDatabase: () => Promise<void>;
  readonly #workerStaleAfterMilliseconds: number;
  readonly #now: () => Date;
  readonly #modelConfigured: boolean;
  readonly #modelName: string | null;
  readonly #mediaRoot: string | null;

  public constructor(options: PostgresOperationsServiceOptions) {
    this.#database = options.database;
    this.#checkDatabase = options.checkDatabase;
    this.#workerStaleAfterMilliseconds = options.workerStaleAfterSeconds * 1000;
    this.#now = options.now ?? (() => new Date());
    this.#modelConfigured = options.modelConfigured ?? false;
    this.#modelName = options.modelName ?? null;
    this.#mediaRoot = options.mediaRoot ?? null;
  }

  public async getHealth(): Promise<OperationsHealth> {
    const checkedAt = this.#now();
    const api: ComponentHealth = { status: "healthy", lastSeenAt: checkedAt.toISOString() };

    try {
      await this.#checkDatabase();
    } catch {
      return {
        checkedAt: checkedAt.toISOString(),
        api,
        database: { status: "unavailable", lastSeenAt: null },
        worker: { status: "unknown", lastSeenAt: null },
      };
    }

    let heartbeat: { readonly lastSeenAt: Date } | undefined;
    try {
      [heartbeat] = await this.#database
        .select({ lastSeenAt: runtimeHeartbeats.lastSeenAt })
        .from(runtimeHeartbeats)
        .where(eq(runtimeHeartbeats.component, "worker"))
        .limit(1);
    } catch {
      return {
        checkedAt: checkedAt.toISOString(),
        api,
        database: { status: "unavailable", lastSeenAt: null },
        worker: { status: "unknown", lastSeenAt: null },
      };
    }
    const workerLastSeenAt = heartbeat?.lastSeenAt ?? null;
    const workerStatus: RuntimeHealthStatus =
      workerLastSeenAt === null
        ? "unknown"
        : checkedAt.getTime() - workerLastSeenAt.getTime() <= this.#workerStaleAfterMilliseconds
          ? "healthy"
          : "stale";

    return {
      checkedAt: checkedAt.toISOString(),
      api,
      database: { status: "healthy", lastSeenAt: checkedAt.toISOString() },
      worker: { status: workerStatus, lastSeenAt: workerLastSeenAt?.toISOString() ?? null },
    };
  }

  public async recordWorkerHeartbeat(instanceId: string, startedAt: Date): Promise<void> {
    const lastSeenAt = this.#now();
    await this.#database
      .insert(runtimeHeartbeats)
      .values({
        component: "worker",
        instanceId,
        startedAt,
        lastSeenAt,
        metadata: {},
      })
      .onConflictDoUpdate({
        target: runtimeHeartbeats.component,
        set: { instanceId, startedAt, lastSeenAt },
      });
  }

  public async getSummary(): Promise<OperationsSummary> {
    const now = this.#now();
    const taskRows = await this.#database
      .select({ status: backgroundTasks.status, count: sql<number>`count(*)::int` })
      .from(backgroundTasks)
      .groupBy(backgroundTasks.status);
    const mediaRows = await this.#database
      .select({ status: temporaryMedia.status, count: sql<number>`count(*)::int` })
      .from(temporaryMedia)
      .groupBy(temporaryMedia.status);
    const [expired] = await this.#database
      .select({ count: sql<number>`count(*)::int` })
      .from(temporaryMedia)
      .where(sql`${temporaryMedia.status} = 'available' and ${temporaryMedia.expiresAt} <= ${now}`);
    const events = await this.#database
      .select({
        type: maintenanceEvents.type,
        status: maintenanceEvents.status,
        completedAt: maintenanceEvents.completedAt,
      })
      .from(maintenanceEvents)
      .orderBy(desc(maintenanceEvents.completedAt));
    const eventAt = (type: string, status: string) =>
      events.find((event) => event.type === type && event.status === status)?.completedAt.toISOString() ?? null;
    let availableBytes: number | null = null;
    if (this.#mediaRoot !== null) {
      try {
        const disk = await statfs(this.#mediaRoot);
        availableBytes = Number(disk.bavail * disk.bsize);
      } catch {
        availableBytes = null;
      }
    }
    const taskCounts = { pending: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
    for (const row of taskRows) taskCounts[row.status] = row.count;
    const mediaCounts = {
      available: 0,
      deletion_pending: 0,
      deleted: 0,
      missing: 0,
      expiredAvailable: expired?.count ?? 0,
    };
    for (const row of mediaRows) mediaCounts[row.status] = row.count;
    return {
      checkedAt: now.toISOString(),
      model: {
        configured: this.#modelConfigured,
        model: this.#modelConfigured ? this.#modelName : null,
      },
      tasks: taskCounts,
      media: mediaCounts,
      disk: { availableBytes },
      backup: {
        lastSucceededAt: eventAt("backup", "succeeded"),
        lastFailedAt: eventAt("backup", "failed"),
      },
      restoreVerification: {
        lastSucceededAt: eventAt("restore_verification", "succeeded"),
        lastFailedAt: eventAt("restore_verification", "failed"),
      },
    };
  }
}
